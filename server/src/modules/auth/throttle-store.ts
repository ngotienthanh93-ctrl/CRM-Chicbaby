// 🔴 CWE-307: bộ đếm chống brute-force PERSIST ở DB (bảng throttle_entries) — chia sẻ đa-instance,
// không mất khi restart tiến trình. Dùng CHUNG logic thuần computeLock/computeFailure với LoginThrottle.
// Đọc-sửa-ghi bọc trong transaction Serializable CÓ retry (P2034) để 2 lần sai đồng thời không đếm sai.
//
// CONTROL đã có (app-level):
//   1) Burst song song ĐÃ ĐÓNG: reserveAttemptDb() đặt-chỗ+đếm NGUYÊN TỬ (Serializable+retry) TRƯỚC khi
//      verify mật khẩu ⇒ các yêu cầu song song cùng key bị tuần tự hóa, tối đa softThreshold lần verify.
//   2) Phình bảng do spray: dọn CƠ HỘI (~2% mỗi lần thử) + scheduled cleanup định kỳ (index.ts gọi
//      cleanupStaleThrottle mỗi 10 phút).
// ⚠️ CÒN LẠI ở TẦNG HẠ TẦNG (ngoài app): tấn công THỂ TÍCH lớn (nhiều IP/subnet) vẫn nên chặn bằng
//    RATE-LIMIT ở EDGE (WAF/reverse-proxy). Đa-instance nên tách cleanup thành cron riêng thay setInterval.
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { runSerializable } from '../../lib/serializable';
import {
  computeFailure,
  computeLock,
  DEFAULT_THROTTLE,
  type Entry,
  type ThrottleConfig,
} from './login-throttle';

export type ThrottleScope = 'login' | 'reauth';

/**
 * Id lưu trong DB = sha256("<scope>\0<key>") — HASH độ dài cố định (64 hex):
 * - tách hẳn không gian đếm login vs reauth,
 * - 🔴 chặn key thô (username không giới hạn) làm khóa chính vượt trần index Postgres (CWE-400/DoS).
 */
function storeId(scope: ThrottleScope, key: string): string {
  return crypto.createHash('sha256').update(`${scope}\0${key}`).digest('hex');
}

/** Bản ghi DB → Entry thuần (lockedUntil null ⇒ 0 = không khóa). */
function toEntry(row: { fails: number; firstFailAt: Date; lockedUntil: Date | null } | null): Entry | null {
  if (!row) return null;
  return {
    fails: row.fails,
    firstFailAt: row.firstFailAt.getTime(),
    lockedUntil: row.lockedUntil ? row.lockedUntil.getTime() : 0,
  };
}

export interface ReserveResult {
  /** false = ĐANG bị khóa ⇒ KHÔNG cho thử mật khẩu (không cộng thêm). */
  allowed: boolean;
  /** Sau khi đặt chỗ, khóa đã (đang) bật? (dùng để trả 429 vs 401 khi mật khẩu sai). */
  locked: boolean;
  retryAfterMs: number;
  fails: number;
}

/**
 * 🔴 ĐẶT CHỖ 1 lần thử (atomic, retry) TRƯỚC khi verify mật khẩu — đóng cửa sổ burst song song:
 * đọc trạng thái + kiểm khóa + cộng dồn 1 lần SAI trong CÙNG transaction Serializable, nên các yêu cầu
 * song song cùng key bị tuần tự hóa ⇒ tối đa `softThreshold` lần được phép verify trước khi khóa.
 * - Đang khóa ⇒ allowed=false (KHÔNG cộng thêm).
 * - Chưa khóa ⇒ cộng dồn (coi như sai tạm) rồi allowed=true; nếu mật khẩu ĐÚNG, caller gọi recordSuccessDb để XÓA.
 * KHÔNG giữ lock trong lúc băm scrypt (verify chạy NGOÀI transaction) ⇒ không cạn connection-pool.
 */
export async function reserveAttemptDb(
  scope: ThrottleScope,
  key: string,
  now: number = Date.now(),
  cfg: ThrottleConfig = DEFAULT_THROTTLE,
): Promise<ReserveResult> {
  const id = storeId(scope, key);
  const result = await runSerializable(async (tx): Promise<ReserveResult> => {
    const entry = toEntry(await tx.throttleEntry.findUnique({ where: { key: id } }));
    const lock = computeLock(entry, now);
    if (lock.locked) {
      return { allowed: false, locked: true, retryAfterMs: lock.retryAfterMs, fails: entry?.fails ?? 0 };
    }
    const res = computeFailure(entry, now, cfg);
    const data = {
      scope,
      fails: res.entry.fails,
      firstFailAt: new Date(res.entry.firstFailAt),
      lockedUntil: res.entry.lockedUntil > 0 ? new Date(res.entry.lockedUntil) : null,
    };
    await tx.throttleEntry.upsert({ where: { key: id }, create: { key: id, ...data }, update: data });
    return {
      allowed: true,
      locked: res.status.locked,
      retryAfterMs: res.status.retryAfterMs,
      fails: res.status.fails,
    };
  });
  // 🔴 Dọn rác CƠ HỘI (không chặn response): tránh row tăng vô hạn khi bị spray username/IP ngẫu nhiên.
  if (Math.random() < 0.02) {
    void cleanupStaleThrottle(now, cfg).catch(() => {
      /* dọn rác lỗi thì bỏ qua — không ảnh hưởng luồng đăng nhập */
    });
  }
  return result;
}

/** THÀNH CÔNG ⇒ xóa bộ đếm cho khóa này (idempotent — không lỗi nếu chưa có). */
export async function recordSuccessDb(scope: ThrottleScope, key: string): Promise<void> {
  await prisma.throttleEntry.deleteMany({ where: { key: storeId(scope, key) } });
}

/**
 * 🔴 Xóa các bản ghi throttle KHÔNG còn ý nghĩa: hết khóa (hoặc chưa từng khóa) VÀ cửa sổ đếm đã qua —
 * computeFailure dù sao cũng reset chúng. Giữ bảng nhỏ (chống phình do login-spray).
 */
export async function cleanupStaleThrottle(
  now: number = Date.now(),
  cfg: ThrottleConfig = DEFAULT_THROTTLE,
): Promise<number> {
  const staleBefore = new Date(now - cfg.windowMs);
  const res = await prisma.throttleEntry.deleteMany({
    where: {
      updatedAt: { lt: staleBefore },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now) } }],
    },
  });
  return res.count;
}

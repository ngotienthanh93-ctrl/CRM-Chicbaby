// 🔴 SEC-FIX-4 (brute force CWE-307 · AUTH-03/04): giới hạn số lần đăng nhập sai + khóa tạm.
// AUTH-03: khóa 15 phút sau 5 lần sai, 24h sau 10 lần sai.
// AUTH-04: khóa theo (username + IP), KHÔNG khóa toàn cục (tránh DoS 1 tài khoản/ khóa nhầm cả hệ thống).
//
// LOGIC THUẦN (computeLock/computeFailure) tách riêng để test được và DÙNG CHUNG cho:
//   - `LoginThrottle` (Map trong bộ nhớ) — dùng cho unit test/ fallback.
//   - store DB (`throttle-store.ts`) — PERSIST bộ đếm, chia sẻ đa-instance, không mất khi restart (production).

export interface ThrottleConfig {
  /** Số lần sai để khóa mềm. */
  softThreshold: number;
  /** Thời gian khóa mềm (ms). */
  softLockMs: number;
  /** Số lần sai để khóa cứng. */
  hardThreshold: number;
  /** Thời gian khóa cứng (ms). */
  hardLockMs: number;
  /** Cửa sổ đếm: quá hạn không bị khóa thì reset bộ đếm (ms). */
  windowMs: number;
}

export const DEFAULT_THROTTLE: ThrottleConfig = {
  softThreshold: 5,
  softLockMs: 15 * 60 * 1000, // 15 phút
  hardThreshold: 10,
  hardLockMs: 24 * 60 * 60 * 1000, // 24 giờ
  windowMs: 24 * 60 * 60 * 1000,
};

export interface Entry {
  fails: number;
  firstFailAt: number;
  lockedUntil: number; // 0 = không khóa
}

export interface LockStatus {
  locked: boolean;
  retryAfterMs: number;
}

export interface FailureStatus {
  fails: number;
  locked: boolean;
  retryAfterMs: number;
}

/** Khóa đếm theo (username + ip). Chuẩn hóa username về lowercase để không né bằng khác hoa/thường. */
export function throttleKey(username: string, ip: string | undefined): string {
  return `${username.trim().toLowerCase()}::${ip ?? 'unknown'}`;
}

// ---------- LOGIC THUẦN (không I/O) — nguồn sự thật cho cả in-memory lẫn store DB ----------

/** Trạng thái khóa theo entry hiện tại (null/undefined = chưa có bản ghi). */
export function computeLock(entry: Entry | null | undefined, now: number = Date.now()): LockStatus {
  if (entry && entry.lockedUntil > now) {
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }
  return { locked: false, retryAfterMs: 0 };
}

/**
 * Cộng dồn 1 lần SAI (THUẦN — không mutate input). Trả entry MỚI + trạng thái.
 * - Cửa sổ cũ hết hạn và KHÔNG còn khóa ⇒ reset bộ đếm.
 * - Đạt ngưỡng cứng ⇒ khóa cứng; ngưỡng mềm ⇒ khóa mềm.
 */
export function computeFailure(
  entry: Entry | null | undefined,
  now: number = Date.now(),
  cfg: ThrottleConfig = DEFAULT_THROTTLE,
): { entry: Entry; status: FailureStatus } {
  let e = entry ?? undefined;
  if (e && e.lockedUntil <= now && now - e.firstFailAt > cfg.windowMs) {
    e = undefined; // cửa sổ hết hạn ⇒ bắt đầu lại
  }
  const next: Entry = e
    ? { ...e }
    : { fails: 0, firstFailAt: now, lockedUntil: 0 };
  next.fails += 1;
  if (next.fails >= cfg.hardThreshold) {
    next.lockedUntil = now + cfg.hardLockMs;
  } else if (next.fails >= cfg.softThreshold) {
    next.lockedUntil = now + cfg.softLockMs;
  }
  return {
    entry: next,
    status: {
      fails: next.fails,
      locked: next.lockedUntil > now,
      retryAfterMs: next.lockedUntil > now ? next.lockedUntil - now : 0,
    },
  };
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly cfg: ThrottleConfig = DEFAULT_THROTTLE) {}

  /** Đang bị khóa không? (kiểm tra TRƯỚC khi thử mật khẩu). */
  isLocked(key: string, now: number = Date.now()): LockStatus {
    return computeLock(this.entries.get(key), now);
  }

  /** Ghi nhận 1 lần đăng nhập SAI. Trả trạng thái sau khi cộng dồn. */
  recordFailure(key: string, now: number = Date.now()): FailureStatus {
    const { entry, status } = computeFailure(this.entries.get(key), now, this.cfg);
    this.entries.set(key, entry);
    return status;
  }

  /** Đăng nhập THÀNH CÔNG => xóa bộ đếm cho khóa này. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Dọn thủ công (dùng cho test). */
  reset(): void {
    this.entries.clear();
  }
}

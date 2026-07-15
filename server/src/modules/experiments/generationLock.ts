// 🔴 A04/TOCTOU: khóa CHO THUÊ (lease) chống chạy CHỒNG lượt "sinh việc" (runExperimentGeneration).
// Cả cron worker holdout LẪN POST /api/experiments/run đều acquire CÙNG lease trước khi chạy ⇒ tại một
// thời điểm chỉ MỘT lượt sinh việc (kể cả đa-instance / manual trùng cron tick). Đọc-kiểm-ghi NGUYÊN TỬ
// trong transaction Serializable + retry (đồng idiom với throttle-store) ⇒ 2 acquire song song: một thắng.
// Luôn release ở finally; TTL chỉ phòng tiến trình crash giữa chừng (lease tự hết hạn, không kẹt vĩnh viễn).
//
// 🔴 FENCING TOKEN (chống nhả nhầm): mỗi lần acquire sinh TOKEN duy nhất lưu vào cột holder; release CHỈ nhả
// khi holder VẪN đúng token của mình. Nhờ vậy nếu 1 lượt lỡ chạy quá TTL và lượt khác đã giành lease, thì
// lượt cũ khi kết thúc KHÔNG nhả nhầm lease của lượt mới (release thành no-op). TTL đặt rộng hơn NHIỀU so với
// thời lượng thực tế 1 lượt (đo được < giây) ⇒ trường hợp quá hạn gần như không xảy ra; nếu lượt chạy có thể
// kéo dài hơn, cân nhắc heartbeat làm mới lease (chưa cần ở quy mô hiện tại).
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { runSerializable } from '../../lib/serializable';

/** Tên lease MẶC ĐỊNH cho tác vụ sinh việc thí nghiệm (một hàng scheduler_leases). */
const LEASE_NAME = 'experiment_generation';

/** Hạn giữ lease (ms). Rộng-rãi so với thời lượng 1 lượt sinh việc; chỉ có ý nghĩa khi tiến trình crash. */
export const GENERATION_LEASE_TTL_MS = 10 * 60 * 1000;

/**
 * Thử GIỮ lease. Trả TOKEN duy nhất (chuỗi) nếu giữ được (chưa ai giữ hoặc lease cũ đã hết hạn),
 * hoặc `null` nếu đang có lượt khác. Token phải được truyền lại cho releaseGenerationLease để nhả đúng chủ.
 * `label` (vd 'manual'/'cron') chỉ để chẩn đoán — được nhúng vào token cho dễ đọc. NGUYÊN TỬ nhờ Serializable.
 * `leaseName` cho phép TÁI DÙNG cơ chế cho tác vụ khác (vd 'sync_backfill') — mỗi tên = một hàng lease ĐỘC LẬP
 * ⇒ backfill KHÔNG kẹt chung với sinh việc thí nghiệm. Mặc định = lease sinh việc (giữ tương thích call-site cũ).
 */
export async function acquireGenerationLease(
  label: string,
  leaseName: string = LEASE_NAME,
  now: number = Date.now(),
  ttlMs: number = GENERATION_LEASE_TTL_MS,
): Promise<string | null> {
  const token = `${label}:${crypto.randomUUID()}`;
  const acquired = await runSerializable(async (tx) => {
    const row = await tx.schedulerLease.findUnique({ where: { name: leaseName } });
    if (row && row.lockedUntil.getTime() > now) return false; // đang có lượt khác giữ
    const lockedUntil = new Date(now + ttlMs);
    await tx.schedulerLease.upsert({
      where: { name: leaseName },
      create: { name: leaseName, lockedUntil, holder: token },
      update: { lockedUntil, holder: token },
    });
    return true;
  });
  return acquired ? token : null;
}

/**
 * NHẢ lease — CHỈ khi holder vẫn đúng `token` (fencing): tránh nhả nhầm lease đã bị lượt khác giành sau khi
 * lease của mình hết TTL. Idempotent, không lỗi nếu hàng không còn hoặc đã bị lượt khác chiếm.
 * `leaseName` phải khớp tên đã acquire (mặc định = lease sinh việc thí nghiệm).
 */
export async function releaseGenerationLease(token: string, leaseName: string = LEASE_NAME): Promise<void> {
  await prisma.schedulerLease.updateMany({
    where: { name: leaseName, holder: token },
    data: { lockedUntil: new Date(0) },
  });
}

/**
 * GIA HẠN lease — CHỈ khi holder vẫn đúng `token` (fencing): đẩy `lockedUntil` thêm `ttlMs`. Dùng cho tác vụ
 * NỀN chạy DÀI (vd backfill rate-limit) để lease KHÔNG hết hạn giữa chừng ⇒ tránh lượt khác chen vào chạy chồng
 * (CWE-362). Idempotent; no-op nếu đã bị lượt khác chiếm (holder khác) ⇒ KHÔNG cướp lại lease đã mất.
 */
export async function renewGenerationLease(
  token: string,
  leaseName: string = LEASE_NAME,
  now: number = Date.now(),
  ttlMs: number = GENERATION_LEASE_TTL_MS,
): Promise<void> {
  await prisma.schedulerLease.updateMany({
    where: { name: leaseName, holder: token },
    data: { lockedUntil: new Date(now + ttlMs) },
  });
}

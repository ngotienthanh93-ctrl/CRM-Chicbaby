// 🔴 Xác thực 2 lớp (2FA/TOTP) + mã dự phòng + thiết bị tin cậy.
// Nguyên tắc: secret TOTP lưu MÃ HÓA (AES-GCM), backup code lưu HASH; chỉ bật 2FA sau khi xác minh mã đầu.
// Bảo mật thực thi SERVER-SIDE. Mọi ngưỡng (số ngày tin cậy, số backup code) đọc từ config active (#9).
import { prisma } from '../../lib/prisma';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import {
  encryptSecret,
  decryptSecret,
  generateBackupCode,
  hashBackupCode,
  generateSessionToken,
  hashSessionToken,
} from '../../lib/crypto';
import { generateTotpSecret, totpAuthUri, verifyTotp } from '../../lib/totp';

const ISSUER = 'CRM Chicbaby';
const DAY_MS = 24 * 60 * 60 * 1000;

/** ⚙️ Đọc cấu hình 2FA active (fallback DEFAULT). */
async function activeTwofaConfig(): Promise<{ trustedDeviceDays: number; backupCodeCount: number }> {
  const rows = await prisma.configurationVersion.findMany({
    where: { key: { in: ['twofa.trusted_device_days', 'twofa.backup_code_count'] }, isActive: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const days = byKey.get('twofa.trusted_device_days');
  const count = byKey.get('twofa.backup_code_count');
  return {
    trustedDeviceDays: Number.isFinite(days) ? (days as number) : DEFAULT_ENGINE_CONFIG.twofa.trustedDeviceDays,
    backupCodeCount: Number.isFinite(count) ? (count as number) : DEFAULT_ENGINE_CONFIG.twofa.backupCodeCount,
  };
}

export interface TwoFactorStatus {
  enabled: boolean;
  enrolledAt: Date | null;
  backupCodesRemaining: number;
}

/** Trạng thái 2FA của user (cho màn cài đặt). */
export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorEnrolledAt: true },
  });
  const backupCodesRemaining = user.twoFactorEnabled
    ? await prisma.twoFactorBackupCode.count({ where: { userId, usedAt: null } })
    : 0;
  return { enabled: user.twoFactorEnabled, enrolledAt: user.twoFactorEnrolledAt, backupCodesRemaining };
}

/**
 * Bắt đầu enroll: sinh secret mới, LƯU MÃ HÓA (chưa bật), trả secret base32 + otpauth URI (client render QR).
 * KHÔNG cho enroll lại khi đã bật (phải disable trước) — tránh ghi đè secret đang dùng.
 */
export async function setupTwoFactor(
  userId: string,
  username: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true } });
  if (user.twoFactorEnabled) throw new Error('2FA đã bật — hãy tắt trước khi thiết lập lại.');
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: encryptSecret(secret) } });
  return { secret, otpauthUri: totpAuthUri(secret, username, ISSUER) };
}

/**
 * Bật 2FA sau khi người dùng xác minh mã đầu tiên từ authenticator. Sinh backup codes MỚI (trả THÔ một lần).
 * Trả null nếu mã sai (giữ nguyên trạng thái chưa bật). Toàn bộ trong transaction.
 */
export async function enableTwoFactor(userId: string, code: string): Promise<{ backupCodes: string[] } | null> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });
  if (user.twoFactorEnabled) throw new Error('2FA đã bật.');
  if (!user.twoFactorSecret) throw new Error('Chưa thiết lập 2FA (gọi setup trước).');
  const secret = decryptSecret(user.twoFactorSecret);
  if (!verifyTotp(secret, code)) return null;

  const { backupCodeCount } = await activeTwofaConfig();
  const plainCodes = Array.from({ length: backupCodeCount }, () => generateBackupCode());
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorEnrolledAt: new Date() },
    });
    // Xóa backup cũ (nếu có) rồi tạo mới.
    await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
    await tx.twoFactorBackupCode.createMany({
      data: plainCodes.map((c) => ({ userId, codeHash: hashBackupCode(c) })),
    });
  });
  return { backupCodes: plainCodes };
}

/** Tắt 2FA: xóa secret + backup codes + THU HỒI mọi thiết bị tin cậy (không còn bỏ qua 2FA). */
export async function disableTwoFactor(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorEnrolledAt: null },
    });
    await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
    await tx.trustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

/** Phát lại backup codes (thu hồi bộ cũ). Trả bộ mới THÔ một lần. Chỉ khi 2FA đang bật. */
export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true } });
  if (!user.twoFactorEnabled) throw new Error('2FA chưa bật.');
  const { backupCodeCount } = await activeTwofaConfig();
  const plainCodes = Array.from({ length: backupCodeCount }, () => generateBackupCode());
  await prisma.$transaction(async (tx) => {
    await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
    await tx.twoFactorBackupCode.createMany({
      data: plainCodes.map((c) => ({ userId, codeHash: hashBackupCode(c) })),
    });
  });
  return plainCodes;
}

/**
 * 🔴 Xác minh mã khi ĐĂNG NHẬP: thử TOTP trước; nếu không khớp, thử BACKUP CODE (dùng một lần, đánh dấu used).
 * Trả true nếu hợp lệ. Backup code khớp được đánh dấu usedAt NGUYÊN TỬ (conditional update chống dùng lại đua nhau).
 */
export async function verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return false;

  // 1) TOTP
  if (verifyTotp(decryptSecret(user.twoFactorSecret), code)) return true;

  // 2) Backup code (dùng một lần). Chuẩn hóa + hash rồi tiêu thụ NGUYÊN TỬ (updateMany where usedAt null).
  const hash = hashBackupCode(code);
  const consumed = await prisma.twoFactorBackupCode.updateMany({
    where: { userId, codeHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return consumed.count === 1;
}

// ---- Thiết bị tin cậy ----
export interface TrustedDeviceDto {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

/** Tạo thiết bị tin cậy: sinh token (đưa vào cookie), lưu HASH + hạn. Trả token thô để set cookie. */
export async function trustDevice(userId: string, deviceLabel: string | null): Promise<{ token: string; maxAgeMs: number }> {
  const { trustedDeviceDays } = await activeTwofaConfig();
  const token = generateSessionToken();
  const maxAgeMs = trustedDeviceDays * DAY_MS;
  await prisma.trustedDevice.create({
    data: {
      userId,
      deviceLabel,
      fingerprint: hashSessionToken(token),
      expiresAt: new Date(Date.now() + maxAgeMs),
      lastUsedAt: new Date(),
    },
  });
  return { token, maxAgeMs };
}

/** Thiết bị (theo token cookie) có đang được tin cậy cho user này? Còn hạn + chưa thu hồi. Cập nhật lastUsedAt. */
export async function isDeviceTrusted(userId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const device = await prisma.trustedDevice.findUnique({ where: { fingerprint: hashSessionToken(token) } });
  if (!device || device.userId !== userId || device.revokedAt) return false;
  // 🔴 KHÔNG có hạn (null) ⇒ COI LÀ KHÔNG hợp lệ (không cho bypass 2FA vĩnh viễn). Hết hạn ⇒ cũng loại.
  if (!device.expiresAt || device.expiresAt <= new Date()) return false;
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
  return true;
}

/** Danh sách thiết bị tin cậy CÒN HIỆU LỰC của user (cho màn quản lý). */
export async function listTrustedDevices(userId: string): Promise<TrustedDeviceDto[]> {
  const rows = await prisma.trustedDevice.findMany({
    // Chỉ thiết bị CÒN HIỆU LỰC: chưa thu hồi + còn hạn (đồng nhất với isDeviceTrusted).
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, deviceLabel: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  return rows;
}

/** Thu hồi MỘT thiết bị tin cậy của user (chỉ của chính user — chặn thu hồi chéo). */
export async function revokeTrustedDevice(userId: string, id: string): Promise<boolean> {
  const res = await prisma.trustedDevice.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count === 1;
}

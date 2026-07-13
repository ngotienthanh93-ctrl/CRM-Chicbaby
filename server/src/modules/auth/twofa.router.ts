// 🔴 Quản lý 2FA của CHÍNH người dùng (self-service). Mount dưới /api/auth/2fa.
// Thao tác nhạy cảm (setup/enable/disable/phát lại backup) ⇒ nhập lại mật khẩu (reauth, AUTH-12) + audit.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, notFound } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { writeAudit } from '../../security/audit';
import { verifyReauth } from '../../security/reauth';
import {
  getTwoFactorStatus,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  regenerateBackupCodes,
  listTrustedDevices,
  revokeTrustedDevice,
} from './twofa.service';

export const twofaRouter = Router();
twofaRouter.use(requireAuth);

const reauthSchema = z.object({ password: z.string().min(1) });
const enableSchema = z.object({ password: z.string().min(1), code: z.string().min(1).max(20) });

// GET /api/auth/2fa/status — trạng thái 2FA của user hiện tại.
twofaRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json(await getTwoFactorStatus(req.auth!.userId));
  }),
);

// POST /api/auth/2fa/setup — reauth; sinh secret (chưa bật) + trả otpauth URI để quét QR.
twofaRouter.post(
  '/setup',
  asyncHandler(async (req, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    const result = await setupTwoFactor(req.auth!.userId, req.auth!.username);
    await writeAudit({
      userId: req.auth!.userId,
      action: 'auth.twofa_setup',
      objectType: 'user',
      objectId: req.auth!.userId,
      ip: req.ip,
    });
    res.json(result); // { secret, otpauthUri } — chỉ trả cho chính chủ đã reauth.
  }),
);

// POST /api/auth/2fa/enable — reauth + mã TOTP đầu tiên; bật 2FA + trả backup codes (một lần).
twofaRouter.post(
  '/enable',
  asyncHandler(async (req, res) => {
    const parsed = enableSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu hoặc mã xác thực.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    const result = await enableTwoFactor(req.auth!.userId, parsed.data.code);
    if (!result) throw badRequest('Mã xác thực không đúng. Kiểm tra lại đồng hồ thiết bị và nhập mã hiện tại.');
    await writeAudit({
      userId: req.auth!.userId,
      action: 'auth.twofa_enabled',
      objectType: 'user',
      objectId: req.auth!.userId,
      ip: req.ip,
    });
    res.json({ backupCodes: result.backupCodes });
  }),
);

// POST /api/auth/2fa/disable — reauth; tắt 2FA + xóa backup + thu hồi thiết bị tin cậy.
twofaRouter.post(
  '/disable',
  asyncHandler(async (req, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    await disableTwoFactor(req.auth!.userId);
    await writeAudit({
      userId: req.auth!.userId,
      action: 'auth.twofa_disabled',
      objectType: 'user',
      objectId: req.auth!.userId,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

// POST /api/auth/2fa/backup-codes — reauth; phát lại backup codes (thu hồi bộ cũ).
twofaRouter.post(
  '/backup-codes',
  asyncHandler(async (req, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Thiếu mật khẩu xác minh.');
    await verifyReauth(req.auth!.userId, parsed.data.password, req.ip);
    const backupCodes = await regenerateBackupCodes(req.auth!.userId);
    await writeAudit({
      userId: req.auth!.userId,
      action: 'auth.twofa_backup_regenerated',
      objectType: 'user',
      objectId: req.auth!.userId,
      ip: req.ip,
    });
    res.json({ backupCodes });
  }),
);

// GET /api/auth/2fa/trusted-devices — danh sách thiết bị tin cậy của user.
twofaRouter.get(
  '/trusted-devices',
  asyncHandler(async (req, res) => {
    res.json({ items: await listTrustedDevices(req.auth!.userId) });
  }),
);

// POST /api/auth/2fa/trusted-devices/:id/revoke — thu hồi 1 thiết bị tin cậy của CHÍNH user.
twofaRouter.post(
  '/trusted-devices/:id/revoke',
  asyncHandler(async (req, res) => {
    const ok = await revokeTrustedDevice(req.auth!.userId, String(req.params.id));
    if (!ok) throw notFound('Không tìm thấy thiết bị tin cậy.');
    await writeAudit({
      userId: req.auth!.userId,
      action: 'auth.twofa_device_revoked',
      objectType: 'trusted_device',
      objectId: String(req.params.id),
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

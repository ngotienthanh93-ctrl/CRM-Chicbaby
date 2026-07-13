import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/http';

// Xử lý lỗi tập trung. KHÔNG lộ lỗi kỹ thuật ra client; log server-side (KHÔNG log secret/SĐT).
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  // Lỗi không lường trước => 500, thông điệp trung tính.
  // eslint-disable-next-line no-console
  console.error('[API ERROR]', err instanceof Error ? err.message : err);
  res.status(500).json({
    error: 'Có lỗi xảy ra, vui lòng thử lại sau.',
    code: 'internal_error',
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Không tìm thấy đường dẫn.', code: 'not_found' });
}

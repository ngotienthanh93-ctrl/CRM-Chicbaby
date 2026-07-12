import type { NextFunction, Request, Response } from 'express';

/** Lỗi API có mã HTTP + thông điệp tiếng Việt (KHÔNG lộ chi tiết kỹ thuật). */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg: string) => new ApiError(400, msg, 'bad_request');
export const unauthorized = (msg = 'Chưa đăng nhập hoặc phiên đã hết hạn.') =>
  new ApiError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Bạn không có quyền thực hiện thao tác này.') =>
  new ApiError(403, msg, 'forbidden');
export const notFound = (msg = 'Không tìm thấy dữ liệu.') => new ApiError(404, msg, 'not_found');
export const conflict = (msg: string) => new ApiError(409, msg, 'conflict');
export const tooManyRequests = (msg: string) => new ApiError(429, msg, 'too_many_requests');

/** Bọc handler async để lỗi throw được chuyển tới error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

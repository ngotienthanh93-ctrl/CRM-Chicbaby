// Client REST gọn: fetch thuần + credentials:'include' (cookie httpOnly phiên).
// Lỗi phân loại theo HTTP status; thông điệp tiếng Việt dễ hiểu, KHÔNG lộ chi tiết kỹ thuật.

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const FALLBACK_BY_STATUS: Record<number, string> = {
  400: 'Dữ liệu chưa hợp lệ, vui lòng kiểm tra lại.',
  401: 'Phiên đăng nhập đã hết hạn.',
  403: 'Bạn không có quyền xem nội dung này.',
  404: 'Không tìm thấy dữ liệu.',
  409: 'Thao tác bị trùng hoặc đang được người khác xử lý.',
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Lỗi mạng — không lộ chi tiết
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.', 'network');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    // Backend trả {error, code}; nếu thiếu thì dùng thông điệp mặc định theo status.
    const serverMsg =
      payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : undefined;
    const code =
      payload && typeof payload === 'object' && typeof (payload as { code?: unknown }).code === 'string'
        ? (payload as { code: string }).code
        : 'error';
    const message = serverMsg ?? FALLBACK_BY_STATUS[res.status] ?? 'Có lỗi xảy ra, vui lòng thử lại.';
    throw new ApiError(res.status, message, code);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

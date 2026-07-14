import { badRequest } from '../../lib/http';

// Chuẩn hóa & kiểm tra link mạng xã hội của khách (SERVER-SIDE).
// Mục tiêu bảo mật: link được lưu rồi render thành href ở client => TUYỆT ĐỐI chỉ cho
// http(s) tới đúng nhóm host (Facebook/Zalo). Chặn javascript:, data:, host lạ (chống XSS/phishing).
// Trả về URL https an toàn để lưu, hoặc null để GỠ link (chuỗi rỗng / null).

const FB_HOSTS = [
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'fb.com',
  'www.fb.com',
  'fb.me',
  'm.me',
  'messenger.com',
  'www.messenger.com',
];

const ZALO_HOSTS = ['zalo.me', 'www.zalo.me', 'chat.zalo.me'];

// Có "scheme:" ở đầu (http:, https:, javascript:, data:, ...)? — theo cú pháp URI của RFC 3986.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Nhận vào chuỗi có scheme, chỉ trả URL nếu là http/https + host nằm trong allowlist; còn lại null. */
function safeUrl(input: string, allowedHosts: string[]): string | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; // chặn javascript:, data:, ...
  if (!allowedHosts.includes(u.hostname.toLowerCase())) return null; // chặn host lạ
  u.protocol = 'https:'; // ép https cho đồng nhất
  return u.toString();
}

/**
 * Chuẩn hóa link Facebook. Chấp nhận:
 *  - URL đầy đủ: https://facebook.com/... , https://m.me/... (host phải thuộc FB_HOSTS)
 *  - Dạng "host/path" không scheme: facebook.com/abc
 *  - Username trần: "chicbaby.shop" hoặc "@chicbaby.shop" => https://facebook.com/<user>
 * Rỗng/null => null (gỡ link). Không hợp lệ => ném 400.
 */
export function normalizeFacebook(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  if (HAS_SCHEME.test(s)) {
    const url = safeUrl(s, FB_HOSTS);
    if (!url) throw badRequest('Link Facebook không hợp lệ (chỉ nhận liên kết facebook.com / m.me).');
    return url;
  }

  // Không có scheme: thử coi như "host/path" trước (vd facebook.com/username)
  const asUrl = safeUrl('https://' + s, FB_HOSTS);
  if (asUrl) return asUrl;

  // Còn lại: username trần (không kèm host)
  const handle = s.replace(/^@/, '');
  if (!/^[A-Za-z0-9.]{1,80}$/.test(handle)) {
    throw badRequest('Link/tên Facebook không hợp lệ.');
  }
  return `https://facebook.com/${handle}`;
}

/**
 * Chuẩn hóa link Zalo. Chấp nhận:
 *  - URL đầy đủ: https://zalo.me/... (host thuộc ZALO_HOSTS)
 *  - Dạng "host/path" không scheme: zalo.me/0912...
 *  - Handle trần: số điện thoại hoặc username => https://zalo.me/<handle>
 * Rỗng/null => null (gỡ link). Không hợp lệ => ném 400.
 */
export function normalizeZalo(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  if (HAS_SCHEME.test(s)) {
    const url = safeUrl(s, ZALO_HOSTS);
    if (!url) throw badRequest('Link Zalo không hợp lệ (chỉ nhận liên kết zalo.me).');
    return url;
  }

  const asUrl = safeUrl('https://' + s, ZALO_HOSTS);
  if (asUrl) return asUrl;

  const handle = s.replace(/^@/, '');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(handle)) {
    throw badRequest('Link/tên Zalo không hợp lệ.');
  }
  return `https://zalo.me/${handle}`;
}

// Tiện ích §11.4 — làm sạch (scrub) lỗi kỹ thuật TRƯỚC khi trả client.
// 🔴 SEC-10 / FIX-7: log/thông báo KHÔNG được chứa secret/token/OTP/credential/URL nhạy cảm,
// KHÔNG trả nguyên stack trace hay body upstream. Chỉ trả errorCode + errorSummary đã lọc.

const MAX_SUMMARY_LEN = 200;

// Trích mã kỹ thuật ổn định (KHÔNG nhạy cảm) từ đầu thông báo.
const CODE_PATTERNS: RegExp[] = [
  /\bHTTP\s?\d{3}\b/i, // HTTP 500
  /\bE[A-Z]{3,}\b/, // ECONNREFUSED, ETIMEDOUT, ENOTFOUND... (chỉ chữ HOA)
];

export interface ScrubbedSyncError {
  /** mã kỹ thuật ngắn (VD ECONNREFUSED, "HTTP 500") — null nếu không nhận diện được. */
  errorCode: string | null;
  /** tóm tắt lỗi 1 dòng ĐÃ che secret + cắt ngắn — null nếu không có lỗi. */
  errorSummary: string | null;
}

/** Che secret/token/credential trong 1 dòng thông báo (thứ tự áp có chủ đích). */
function redactSecrets(line: string): string {
  return (
    line
      // Bearer/Basic token (áp TRƯỚC pattern header để nuốt trọn giá trị token).
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '***')
      // credential nhúng trong URL: scheme://user:pass@host  => scheme://***@host
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1***@')
      // token trong query string: ?token=xxx / &access_token=xxx => giữ tên khóa, che giá trị
      .replace(
        /([?&])(token|access_token|refresh_token|apikey|api_key|signature|sig|secret|password|otp)=[^\s&"']+/gi,
        '$1$2=***',
      )
      // key=value / key: value cho các khóa nhạy cảm => giữ tên khóa, che giá trị
      .replace(
        /\b(authorization|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|passwd|pwd|api[_-]?key|access[_-]?key|signature|sig|otp|cookie|set-cookie)\b\s*[:=]\s*[^\s&"']+/gi,
        '$1=***',
      )
  );
}

/**
 * 🔴 FIX-7: chuẩn hóa lỗi syncEvent an toàn để trả client.
 * Chỉ giữ DÒNG ĐẦU (cắt stack), che token/secret/credential, cắt độ dài, và trích errorCode nếu có.
 */
export function scrubSyncError(raw: string | null | undefined): ScrubbedSyncError {
  if (!raw || raw.trim() === '') return { errorCode: null, errorSummary: null };

  // 1) Chỉ lấy dòng đầu (loại stack trace nhiều dòng).
  const firstLine = raw.split(/\r?\n/, 1)[0]!.trim();

  // 2) Trích errorCode TRƯỚC khi che (mã kỹ thuật không nhạy cảm).
  let errorCode: string | null = null;
  for (const re of CODE_PATTERNS) {
    const m = re.exec(firstLine);
    if (m) {
      errorCode = m[0].toUpperCase().replace(/^HTTP\s?/, 'HTTP ');
      break;
    }
  }

  // 3) Che secret/token/credential, rồi cắt độ dài tối đa.
  let scrubbed = redactSecrets(firstLine);
  if (scrubbed.length > MAX_SUMMARY_LEN) scrubbed = scrubbed.slice(0, MAX_SUMMARY_LEN - 1) + '…';

  return { errorCode, errorSummary: scrubbed };
}

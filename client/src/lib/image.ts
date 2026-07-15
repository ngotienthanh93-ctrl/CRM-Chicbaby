// Nén ảnh phía client TRƯỚC khi gửi base64 trong body JSON (giảm payload, giữ mô hình chống CSRF).
// Resize cạnh dài tối đa maxEdge, xuất JPEG quality => mục tiêu ~200-400KB/ảnh.

export interface CompressImageOptions {
  /** Cạnh dài tối đa (px). */
  maxEdge?: number;
  /** Chất lượng JPEG 0..1. */
  quality?: number;
}

/**
 * Nén 1 file ảnh thành data URL JPEG. Từ chối file không phải ảnh (file.type không bắt đầu "image/").
 * Ném Error tiếng Việt nếu không đọc/giải mã được ảnh.
 */
export async function compressImage(file: File, opts?: CompressImageOptions): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Chỉ chọn được tệp ảnh.');
  }
  const maxEdge = opts?.maxEdge ?? 1600;
  const quality = opts?.quality ?? 0.7;

  const bitmap = await loadImage(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không xử lý được ảnh trên thiết bị này.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close?.();
  }
}

/** Đọc kích thước gốc + trả nguồn vẽ được lên canvas. Ưu tiên createImageBitmap, fallback <img>. */
async function loadImage(
  file: File,
): Promise<{ width: number; height: number; close?: () => void } & CanvasImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Một số trình duyệt không hỗ trợ định dạng => rơi xuống fallback <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không đọc được ảnh đã chọn.'));
      el.src = url;
    });
    return Object.assign(img, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Tính kích thước sau khi thu về trong hộp maxEdge (giữ tỉ lệ, không phóng to). */
function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

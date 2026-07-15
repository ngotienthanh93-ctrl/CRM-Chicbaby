import { describe, it, expect } from 'vitest';
import { parseImageDataUrl, MAX_EVIDENCE_BYTES } from './attachments';

// Buffer có MAGIC BYTES thật (helper xác minh chữ ký nhị phân, không tin MIME khai báo).
const jpegBuf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')]);
const pngBuf = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body'),
]);
const webpBuf = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // 'RIFF'
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // file size (bỏ qua)
  Buffer.from([0x57, 0x45, 0x42, 0x50]), // 'WEBP'
  Buffer.from('vp8-body'),
]);

const dataUrl = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`;

describe('parseImageDataUrl', () => {
  it('chấp nhận jpeg/png/webp có magic bytes thật và decode đúng bytes', () => {
    for (const [mime, buf, expected] of [
      ['image/jpeg', jpegBuf, 'image/jpeg'],
      ['image/png', pngBuf, 'image/png'],
      ['image/webp', webpBuf, 'image/webp'],
    ] as const) {
      const r = parseImageDataUrl(dataUrl(mime, buf), MAX_EVIDENCE_BYTES);
      expect(r.mimeType).toBe(expected);
      expect(Buffer.compare(r.buffer, buf)).toBe(0);
    }
  });

  it('image/jpg (biến thể) có magic bytes jpeg => mimeType chuẩn hóa image/jpeg từ magic bytes', () => {
    const r = parseImageDataUrl(dataUrl('image/jpg', jpegBuf), MAX_EVIDENCE_BYTES);
    expect(r.mimeType).toBe('image/jpeg');
  });

  it('🔴 bytes PNG nhưng khai báo image/jpeg => dùng loại phát hiện từ magic bytes (png)', () => {
    const r = parseImageDataUrl(dataUrl('image/jpeg', pngBuf), MAX_EVIDENCE_BYTES);
    expect(r.mimeType).toBe('image/png');
  });

  it('🔴 chặn payload rác gắn nhãn ảnh (không đúng magic bytes)', () => {
    const junk = Buffer.from('hello-evidence');
    expect(() => parseImageDataUrl(dataUrl('image/jpeg', junk), MAX_EVIDENCE_BYTES)).toThrow();
    expect(() => parseImageDataUrl(dataUrl('image/png', junk), MAX_EVIDENCE_BYTES)).toThrow();
    // WEBP thiếu 'WEBP' ở offset 8 (chỉ có RIFF) => từ chối.
    const fakeWebp = Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46]), Buffer.from('not-webp-x')]);
    expect(() => parseImageDataUrl(dataUrl('image/webp', fakeWebp), MAX_EVIDENCE_BYTES)).toThrow();
  });

  it('🔴 chặn mime khai báo không phải ảnh (image/svg+xml, application/pdf, text)', () => {
    expect(() => parseImageDataUrl(dataUrl('image/svg+xml', jpegBuf), MAX_EVIDENCE_BYTES)).toThrow();
    expect(() => parseImageDataUrl(dataUrl('application/pdf', jpegBuf), MAX_EVIDENCE_BYTES)).toThrow();
    expect(() => parseImageDataUrl(dataUrl('text/html', jpegBuf), MAX_EVIDENCE_BYTES)).toThrow();
  });

  it('🔴 chặn chuỗi không phải data URL', () => {
    expect(() => parseImageDataUrl('https://evil.com/x.jpg', MAX_EVIDENCE_BYTES)).toThrow();
    expect(() => parseImageDataUrl('not-a-data-url', MAX_EVIDENCE_BYTES)).toThrow();
    expect(() => parseImageDataUrl('', MAX_EVIDENCE_BYTES)).toThrow();
    // data URL nhưng KHÔNG phải base64 encoding
    expect(() => parseImageDataUrl('data:image/png,rawtext', MAX_EVIDENCE_BYTES)).toThrow();
  });

  it('🔴 chặn ảnh quá lớn (> maxBytes)', () => {
    // maxBytes nhỏ để ép vượt trần mà không phải dựng payload khổng lồ.
    expect(() => parseImageDataUrl(dataUrl('image/png', pngBuf), 4)).toThrow();
  });

  it('🔴 chặn payload rỗng / không hợp lệ', () => {
    expect(() => parseImageDataUrl('data:image/png;base64,', MAX_EVIDENCE_BYTES)).toThrow();
  });
});

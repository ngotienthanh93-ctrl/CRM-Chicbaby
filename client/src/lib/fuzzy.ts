// Tìm kiếm gợi ý gần đúng cho danh sách sản phẩm (lọc phía client).
// Chịu được: gõ thiếu dấu tiếng Việt, sai chính tả nhẹ (Levenshtein per-token),
// khớp một phần (subsequence). Không phụ thuộc npm mới — cài gọn trong repo.

import type { Product } from '../api/types';

const NO_MATCH = Number.NEGATIVE_INFINITY;

// Nhãn mặc định của sản phẩm KV thiếu tên (nguồn: server sync.processor).
const UNNAMED = '(không tên)';

/**
 * Chuẩn hoá chuỗi để so khớp không phân biệt dấu/hoa-thường:
 * lowercase → bỏ dấu tiếng Việt (NFD + xoá dấu tổ hợp) → đ→d → gộp khoảng trắng thừa.
 * null/undefined ⇒ ''.
 */
export function normalizeVi(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // xoá dấu tổ hợp (huyền/sắc/hỏi/ngã/nặng...)
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/** SP coi như "chưa đặt tên" nếu name rỗng hoặc đúng nhãn mặc định KV. */
function isUnnamed(p: Product): boolean {
  const name = (p.name ?? '').trim();
  return name === '' || name === UNNAMED;
}

/**
 * Nhãn hiển thị cho sản phẩm. SP thiếu tên (dữ liệu KV thật) ⇒ dùng mã để nhân viên
 * vẫn nhận diện được, thay vì hiện trơ "(không tên)".
 */
export function productLabel(p: Product): string {
  if (isUnnamed(p)) return `Sản phẩm chưa đặt tên · ${p.code}`;
  return p.name;
}

/** Ngưỡng edit-distance cho phép theo độ dài token (token càng dài, dung sai càng lớn). */
function maxTokenDistance(token: string): number {
  if (token.length <= 3) return 1;
  if (token.length <= 6) return 2;
  return 3;
}

/**
 * Khoảng cách Levenshtein (số phép chèn/xoá/thay tối thiểu). Cài gọn O(n·m),
 * CHỈ dùng cho từng token ngắn để tránh chi phí trên chuỗi dài.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Các ký tự của `query` xuất hiện đúng thứ tự trong `text` (không cần liền mạch). */
function isSubsequence(query: string, text: string): boolean {
  if (!query) return false;
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/** Mọi token của query đều tìm được token gần-đúng trong text (chịu lỗi gõ). */
function fuzzyTokenScore(qTokens: string[], tTokens: string[]): number {
  let totalDist = 0;
  for (const qt of qTokens) {
    const limit = maxTokenDistance(qt);
    let best = Number.POSITIVE_INFINITY;
    for (const tt of tTokens) {
      // Bỏ qua token lệch độ dài quá xa — không thể trong ngưỡng.
      if (Math.abs(qt.length - tt.length) > limit) continue;
      const d = levenshtein(qt, tt);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > limit) return NO_MATCH; // 1 token không khớp ⇒ cả query trượt
    totalDist += best;
  }
  return totalDist;
}

/**
 * Chấm điểm độ khớp query↔text (cả hai ĐÃ normalize). Điểm cao = khớp tốt.
 * Tầng ưu tiên: khớp tuyệt đối > prefix > chứa liền mạch (vị trí sớm hơn cao hơn)
 * > mọi token xuất hiện > subsequence > chịu lỗi gõ (Levenshtein). Không khớp ⇒ -Infinity.
 */
function scoreText(query: string, text: string): number {
  if (!query || !text) return NO_MATCH;
  if (text === query) return 1200;
  if (text.startsWith(query)) return 1000;
  const idx = text.indexOf(query);
  if (idx >= 0) return 800 - Math.min(idx, 199); // vị trí sớm hơn ⇒ điểm cao hơn

  const qTokens = query.split(' ').filter(Boolean);
  const tTokens = text.split(' ').filter(Boolean);

  if (qTokens.length > 1 && qTokens.every((t) => text.includes(t))) return 600;
  if (isSubsequence(query.replace(/ /g, ''), text)) return 400;

  const fuzzy = fuzzyTokenScore(qTokens, tTokens);
  if (fuzzy !== NO_MATCH) return 200 - fuzzy; // dist nhỏ ⇒ điểm cao hơn
  return NO_MATCH;
}

/** Điểm khớp của một sản phẩm = max theo tên và mã (query đã normalize). */
function scoreProduct(query: string, p: Product): number {
  const byName = scoreText(query, normalizeVi(p.name));
  const byCode = scoreText(query, normalizeVi(p.code));
  return Math.max(byName, byCode);
}

/**
 * Lọc + xếp hạng sản phẩm theo `query`, lấy top `limit`.
 * Query rỗng ⇒ trả danh sách nhưng đẩy SP có tên thật lên trước (deprioritize "(không tên)").
 */
export function fuzzySearchProducts(products: Product[], query: string, limit: number): Product[] {
  const q = normalizeVi(query);
  if (!q) {
    // Ổn định thứ tự gốc, chỉ đẩy SP chưa đặt tên xuống cuối.
    return [...products]
      .sort((a, b) => Number(isUnnamed(a)) - Number(isUnnamed(b)))
      .slice(0, limit);
  }
  return products
    .map((p) => ({ p, score: scoreProduct(q, p) }))
    .filter((x) => x.score > NO_MATCH)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

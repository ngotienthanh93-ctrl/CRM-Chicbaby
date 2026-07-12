// Ngày giờ (DT-01..06): LƯU UTC trong DB; HIỂN THỊ & tính "hôm nay"/due_date theo Asia/Ho_Chi_Minh.
// Việt Nam KHÔNG có DST => offset cố định +7h. Dùng offset cố định để tái lập được, tránh phụ thuộc TZ máy.

export const VN_OFFSET_MINUTES = 7 * 60;
const VN_OFFSET_MS = VN_OFFSET_MINUTES * 60 * 1000;

export interface VnDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Tách các thành phần lịch VN từ một mốc UTC. */
export function toVnParts(d: Date): VnDateParts {
  const shifted = new Date(d.getTime() + VN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** Mốc UTC ứng với 00:00 giờ VN của ngày chứa `d` (dùng chuẩn hóa due_date/ngày kinh doanh). */
export function vnStartOfDayUtc(d: Date): Date {
  const p = toVnParts(d);
  // 00:00 VN = 17:00 UTC hôm trước => Date.UTC(...) - offset
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - VN_OFFSET_MS);
}

/** "Hôm nay" theo giờ VN, chuẩn hóa về mốc UTC của 00:00 VN. */
export function vnToday(now: Date = new Date()): Date {
  return vnStartOfDayUtc(now);
}

/** Mốc UTC ứng với 00:00 VN của NGÀY 1 tháng chứa `d` (dùng đếm liên hệ trong tháng — trần chống làm phiền). */
export function vnStartOfMonthUtc(d: Date): Date {
  const p = toVnParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, 1, 0, 0, 0) - VN_OFFSET_MS);
}

/** Cộng số ngày (theo ngày lịch). */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Chênh lệch số ngày lịch VN giữa a và b (a - b), làm tròn xuống. */
export function diffDaysVn(a: Date, b: Date): number {
  const da = vnStartOfDayUtc(a).getTime();
  const db = vnStartOfDayUtc(b).getTime();
  return Math.round((da - db) / (24 * 60 * 60 * 1000));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Định dạng ngày VN: DD/MM/YYYY. */
export function formatVnDate(d: Date): string {
  const p = toVnParts(d);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
}

/** Định dạng ngày giờ VN: DD/MM/YYYY HH:mm. */
export function formatVnDateTime(d: Date): string {
  const p = toVnParts(d);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

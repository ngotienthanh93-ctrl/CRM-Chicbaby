// Guard phòng thủ phía client (nhiều lớp): server đã chuẩn hóa link về http(s) tới host FB/Zalo,
// nhưng UI vẫn kiểm lại — CHỈ render <a href> khi link là http(s), chặn mọi href javascript:/data: (chống XSS).
export function isSafeHttpUrl(v: string | null | undefined): v is string {
  return !!v && (v.startsWith('https://') || v.startsWith('http://'));
}

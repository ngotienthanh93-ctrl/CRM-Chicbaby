// Tư vấn (§11.2 — CON-01..09). Engine THUẦN cho các quyết định không phụ thuộc DB.
import { diffDaysVn } from '../lib/datetime';

/**
 * 🔴 CON-05: chống hẹn gọi lại TRÙNG. Nếu đã có lịch hẹn (service_contact) trong ±windowDays ngày
 * so với ngày hẹn mới ⇒ coi là trùng (KHÔNG tạo việc thứ hai). So sánh theo NGÀY lịch VN.
 */
export function appointmentClashesWithin(
  existingDueDates: Date[],
  newDue: Date,
  windowDays: number,
): boolean {
  return existingDueDates.some((d) => Math.abs(diffDaysVn(newDue, d)) <= windowDays);
}

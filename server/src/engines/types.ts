// Kiểu chuỗi literal cho engine (thuần, không phụ thuộc Prisma client) => test được không cần DB.
// Giá trị TRÙNG KHỚP enum Prisma tương ứng.

export type BabyAssignmentModeStr = 'baby_specific' | 'multi_audience' | 'not_baby_applicable';
export type AssignmentStatusStr =
  | 'auto_assigned'
  | 'suggested'
  | 'confirmed'
  | 'customer_level'
  | 'not_applicable';
export type AssignmentSourceStr = 'auto_single_baby' | 'auto_age_match' | 'manual' | 'unassigned';
export type ConfidenceStr = 'high' | 'medium' | 'low';
export type CustomerRoleStr = 'retail_customer' | 'wholesale_contact';
export type FrequencyCapScopeStr =
  | 'proactive_sales_contact'
  | 'marketing_contact'
  | 'service_contact';
export type OrgStatusStr = 'active' | 'slow' | 'at_risk' | 'paused' | 'lost' | 'collecting';

export const CUSTOMER_LEVEL_KEY = 'customer_level';

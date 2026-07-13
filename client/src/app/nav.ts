import {
  Building2,
  ClipboardList,
  ListTodo,
  Settings,
  Users,
  RefreshCw,
  BarChart3,
  ShieldCheck,
  SlidersHorizontal,
  FlaskConical,
  FileDown,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import type { Permissions } from '../api/types';

export interface NavItem {
  path: string;
  label: string;
  shortLabel: string; // cho bottom-nav (ngắn)
  icon: LucideIcon;
  /** Ẩn menu theo QUYỀN (server vẫn là nơi chặn thật). */
  visible: (p: Permissions) => boolean;
}

// Thứ tự = ưu tiên; bottom-nav mobile lấy đúng danh sách này (đã lọc quyền).
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/viec-hom-nay',
    label: 'Việc hôm nay',
    shortLabel: 'Việc',
    icon: ListTodo,
    visible: () => true,
  },
  {
    path: '/khach',
    label: 'Khách hàng',
    shortLabel: 'Khách',
    icon: Users,
    visible: () => true,
  },
  {
    path: '/phan-bo-be',
    label: 'Phân bổ bé',
    shortLabel: 'Phân bổ',
    icon: ClipboardList,
    // Marketing KHÔNG thấy (viewBaby=false). Server cũng 403.
    visible: (p) => p.viewBaby,
  },
  {
    path: '/dai-ly',
    label: 'Đại lý',
    shortLabel: 'Đại lý',
    icon: Building2,
    visible: (p) => p.viewOrganization,
  },
  {
    path: '/bao-cao',
    label: 'Báo cáo',
    shortLabel: 'Báo cáo',
    icon: BarChart3,
    // §11.5: chu_shop + crm_officer + cskh (đều có viewBaby). Marketing & trợ lý dữ liệu KHÔNG thấy.
    visible: (p) => p.viewBaby,
  },
  {
    path: '/dong-bo',
    label: 'Đồng bộ KiotViet',
    shortLabel: 'Đồng bộ',
    icon: RefreshCw,
    // §11.4: chỉ chu_shop + trợ lý dữ liệu (manageSync). Server cũng chặn 403.
    visible: (p) => p.manageSync,
  },
  {
    path: '/cau-hinh',
    label: 'Cấu hình chu kỳ',
    shortLabel: 'Cấu hình',
    icon: Settings,
    // Ẩn với Marketing; hiển thị cho vai có xem đại lý hoặc theo dõi đồng bộ.
    visible: (p) => p.viewOrganization || p.viewSync,
  },
  {
    path: '/quan-tri',
    label: 'Quản trị',
    shortLabel: 'Quản trị',
    icon: ShieldCheck,
    // §12.1: chỉ Chủ shop/Quản trị (manageUsers). Server cũng chặn 403.
    visible: (p) => p.manageUsers,
  },
  {
    path: '/cau-hinh-he-thong',
    label: 'Cấu hình hệ thống',
    shortLabel: 'Cấu hình HT',
    icon: SlidersHorizontal,
    // §12.2: chỉ Chủ shop/Quản trị (manageConfig). Server cũng chặn 403.
    visible: (p) => p.manageConfig,
  },
  {
    path: '/thi-nghiem',
    label: 'Thí nghiệm',
    shortLabel: 'Thí nghiệm',
    icon: FlaskConical,
    // §12.3: chỉ Chủ shop/Quản trị (manageConfig). Server cũng chặn 403.
    visible: (p) => p.manageConfig,
  },
  {
    path: '/export-du-lieu',
    label: 'Export dữ liệu',
    shortLabel: 'Export',
    icon: FileDown,
    // Export dữ liệu khách/bé cần quyền xem dữ liệu nhạy cảm; marketing/trợ lý dữ liệu KHÔNG thấy. Server cũng 403.
    visible: (p) => p.viewSensitive,
  },
  {
    path: '/bao-mat',
    label: 'Bảo mật',
    shortLabel: 'Bảo mật',
    icon: Lock,
    // Self-service 2FA + thiết bị tin cậy: mọi vai đều xem được cho chính mình.
    visible: () => true,
  },
];

export function visibleNav(perms: Permissions): NavItem[] {
  return NAV_ITEMS.filter((n) => n.visible(perms));
}

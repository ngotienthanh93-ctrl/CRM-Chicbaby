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

export type NavGroup = 'main' | 'system';

export interface NavItem {
  path: string;
  label: string;
  shortLabel: string; // cho bottom-nav (ngắn)
  icon: LucideIcon;
  /** Nhóm hiển thị trên sidebar (chỉ trình bày, không đổi route/quyền). */
  group: NavGroup;
  /** Ẩn menu theo QUYỀN (server vẫn là nơi chặn thật). */
  visible: (p: Permissions) => boolean;
}

/** Nhãn tiêu đề nhóm sidebar (theo nghiệp vụ, không mã kỹ thuật). */
export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  main: 'Vận hành',
  system: 'Dữ liệu & hệ thống',
};

// Thứ tự = ưu tiên; bottom-nav mobile lấy đúng danh sách này (đã lọc quyền).
export const NAV_ITEMS: NavItem[] = [
  {
    path: '/viec-hom-nay',
    label: 'Việc hôm nay',
    shortLabel: 'Việc',
    icon: ListTodo,
    group: 'main',
    visible: () => true,
  },
  {
    path: '/khach',
    label: 'Khách hàng',
    shortLabel: 'Khách',
    icon: Users,
    group: 'main',
    visible: () => true,
  },
  {
    path: '/phan-bo-be',
    label: 'Phân bổ bé',
    shortLabel: 'Phân bổ',
    icon: ClipboardList,
    group: 'main',
    // Marketing KHÔNG thấy (viewBaby=false). Server cũng 403.
    visible: (p) => p.viewBaby,
  },
  {
    path: '/dai-ly',
    label: 'Đại lý',
    shortLabel: 'Đại lý',
    icon: Building2,
    group: 'main',
    visible: (p) => p.viewOrganization,
  },
  {
    path: '/bao-cao',
    label: 'Báo cáo',
    shortLabel: 'Báo cáo',
    icon: BarChart3,
    group: 'system',
    // §11.5: chu_shop + crm_officer + cskh (đều có viewBaby). Marketing & trợ lý dữ liệu KHÔNG thấy.
    visible: (p) => p.viewBaby,
  },
  {
    path: '/dong-bo',
    label: 'Đồng bộ KiotViet',
    shortLabel: 'Đồng bộ',
    icon: RefreshCw,
    group: 'system',
    // §11.4: chỉ chu_shop + trợ lý dữ liệu (manageSync). Server cũng chặn 403.
    visible: (p) => p.manageSync,
  },
  {
    path: '/cau-hinh',
    label: 'Cấu hình chu kỳ',
    shortLabel: 'Cấu hình',
    icon: Settings,
    group: 'system',
    // Ẩn với Marketing; hiển thị cho vai có xem đại lý hoặc theo dõi đồng bộ.
    visible: (p) => p.viewOrganization || p.viewSync,
  },
  {
    path: '/quan-tri',
    label: 'Quản trị',
    shortLabel: 'Quản trị',
    icon: ShieldCheck,
    group: 'system',
    // §12.1: chỉ Chủ shop/Quản trị (manageUsers). Server cũng chặn 403.
    visible: (p) => p.manageUsers,
  },
  {
    path: '/cau-hinh-he-thong',
    label: 'Cấu hình hệ thống',
    shortLabel: 'Cấu hình HT',
    icon: SlidersHorizontal,
    group: 'system',
    // §12.2: chỉ Chủ shop/Quản trị (manageConfig). Server cũng chặn 403.
    visible: (p) => p.manageConfig,
  },
  {
    path: '/thi-nghiem',
    label: 'Thí nghiệm',
    shortLabel: 'Thí nghiệm',
    icon: FlaskConical,
    group: 'system',
    // §12.3: chỉ Chủ shop/Quản trị (manageConfig). Server cũng chặn 403.
    visible: (p) => p.manageConfig,
  },
  {
    path: '/export-du-lieu',
    label: 'Export dữ liệu',
    shortLabel: 'Export',
    icon: FileDown,
    group: 'system',
    // Export dữ liệu khách/bé cần quyền xem dữ liệu nhạy cảm; marketing/trợ lý dữ liệu KHÔNG thấy. Server cũng 403.
    visible: (p) => p.viewSensitive,
  },
  {
    path: '/bao-mat',
    label: 'Bảo mật',
    shortLabel: 'Bảo mật',
    icon: Lock,
    group: 'system',
    // Self-service 2FA + thiết bị tin cậy: mọi vai đều xem được cho chính mình.
    visible: () => true,
  },
];

export function visibleNav(perms: Permissions): NavItem[] {
  return NAV_ITEMS.filter((n) => n.visible(perms));
}

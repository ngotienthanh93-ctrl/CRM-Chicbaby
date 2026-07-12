import {
  Building2,
  ClipboardList,
  ListTodo,
  Settings,
  Users,
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
    path: '/cau-hinh',
    label: 'Cấu hình chu kỳ',
    shortLabel: 'Cấu hình',
    icon: Settings,
    // Ẩn với Marketing; hiển thị cho vai có xem đại lý hoặc theo dõi đồng bộ.
    visible: (p) => p.viewOrganization || p.viewSync,
  },
];

export function visibleNav(perms: Permissions): NavItem[] {
  return NAV_ITEMS.filter((n) => n.visible(perms));
}

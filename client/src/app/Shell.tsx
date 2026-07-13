import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Baby as BabyIcon, MoreHorizontal, X } from 'lucide-react';
import { useAuth } from './AuthContext';
import { visibleNav, NAV_GROUP_LABELS, type NavGroup } from './nav';
import { roleVi } from '../lib/labels';
import { DemoBanner } from '../components/ui';
import type { ReactNode } from 'react';

const GROUP_ORDER: NavGroup[] = ['main', 'system'];
const BOTTOM_NAV_PRIMARY = 4; // số tab hiển thị trực tiếp; phần còn lại vào "Thêm"

export function Shell({ children }: { children: ReactNode }) {
  const { user, permissions, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  if (!user || !permissions) return null;

  const items = visibleNav(permissions);
  const initial = user.fullName.trim().charAt(0).toUpperCase() || 'U';

  const handleLogout = async () => {
    await logout();
    navigate('/dang-nhap', { replace: true });
  };

  // Bottom-nav mobile: 4 tab chính + "Thêm" cho phần còn lại.
  const primary = items.slice(0, BOTTOM_NAV_PRIMARY);
  const overflow = items.slice(BOTTOM_NAV_PRIMARY);
  const overflowActive = overflow.some((i) => location.pathname.startsWith(i.path));

  return (
    <div className="shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden>
            <BabyIcon size={20} />
          </span>
          <span className="brand-text">
            <span className="brand-name">Chic Babyshop</span>
            <span className="brand-sub">PREMIUM CRM</span>
          </span>
        </div>
        <div className="spacer" />
        <div className="topbar-user">
          <div className="topbar-user-info">
            <span className="topbar-user-name">{user.fullName}</span>
            <span className="topbar-user-role">{roleVi[user.role] ?? user.role}</span>
          </div>
          <span className="topbar-avatar" aria-hidden>
            {initial}
          </span>
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>
            <LogOut size={15} aria-hidden />
            <span className="hide-mobile">Đăng xuất</span>
          </button>
        </div>
      </header>

      <div className="shell-body">
        {/* Sidebar desktop — nhóm theo nghiệp vụ */}
        <nav className="sidebar" aria-label="Điều hướng chính">
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div className="side-group" key={group}>
                <div className="side-group-label">{NAV_GROUP_LABELS[group]}</div>
                {groupItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}
                  >
                    <span className="side-link-icon">
                      <item.icon size={18} aria-hidden />
                    </span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {/* Main */}
        <main className="main">
          <DemoBanner />
          <div className="main-inner">{children}</div>
        </main>
      </div>

      {/* Bottom-nav mobile: 4 tab + Thêm */}
      <nav className="bottomnav" aria-label="Điều hướng chính">
        {primary.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `bottomnav-link${isActive ? ' active' : ''}`}
          >
            <item.icon size={20} aria-hidden />
            <span>{item.shortLabel}</span>
          </NavLink>
        ))}
        {overflow.length > 0 && (
          <button
            type="button"
            className={`bottomnav-link${overflowActive ? ' active' : ''}`}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
          >
            <MoreHorizontal size={20} aria-hidden />
            <span>Thêm</span>
          </button>
        )}
      </nav>

      {/* Bottom-sheet "Thêm" — chứa các mục còn lại */}
      {moreOpen && (
        <div
          className="sheet-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Menu thêm"
          onClick={() => setMoreOpen(false)}
        >
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden />
            <div className="between" style={{ padding: '0 4px 8px' }}>
              <span className="h3">Menu</span>
              <button
                className="btn btn-outline btn-icon btn-sm"
                aria-label="Đóng"
                onClick={() => setMoreOpen(false)}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="sheet-grid">
              {overflow.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `sheet-item${isActive ? ' active' : ''}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <span className="sheet-item-icon">
                    <item.icon size={20} aria-hidden />
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

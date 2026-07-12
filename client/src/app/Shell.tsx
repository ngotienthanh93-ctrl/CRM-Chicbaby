import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Baby as BabyIcon } from 'lucide-react';
import { useAuth } from './AuthContext';
import { visibleNav } from './nav';
import { roleVi } from '../lib/labels';
import { DemoBanner } from '../components/ui';
import type { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }) {
  const { user, permissions, logout } = useAuth();
  const navigate = useNavigate();
  if (!user || !permissions) return null;

  const items = visibleNav(permissions);

  const handleLogout = async () => {
    await logout();
    navigate('/dang-nhap', { replace: true });
  };

  return (
    <div className="shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden>
            <BabyIcon size={18} />
          </span>
          <span className="brand-name">CRM Chicbaby</span>
        </div>
        <div className="spacer" />
        <div className="topbar-user">
          <div className="topbar-user-info">
            <span className="topbar-user-name">{user.fullName}</span>
            <span className="topbar-user-role">{roleVi[user.role] ?? user.role}</span>
          </div>
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>
            <LogOut size={15} aria-hidden />
            <span className="hide-mobile">Đăng xuất</span>
          </button>
        </div>
      </header>

      <div className="shell-body">
        {/* Sidebar desktop */}
        <nav className="sidebar" aria-label="Điều hướng chính">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}
            >
              <item.icon size={18} aria-hidden />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Main */}
        <main className="main">
          <DemoBanner />
          <div className="main-inner">{children}</div>
        </main>
      </div>

      {/* Bottom-nav mobile */}
      <nav className="bottomnav" aria-label="Điều hướng chính">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `bottomnav-link${isActive ? ' active' : ''}`}
          >
            <item.icon size={20} aria-hidden />
            <span>{item.shortLabel}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

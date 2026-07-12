import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { UsersTab } from './admin/UsersTab';
import { RolesTab } from './admin/RolesTab';
import { SessionsTab } from './admin/SessionsTab';
import { AuditTab } from './admin/AuditTab';

type TabKey = 'users' | 'roles' | 'sessions' | 'audit';

const TABS: [TabKey, string][] = [
  ['users', 'Người dùng'],
  ['roles', 'Vai & quyền'],
  ['sessions', 'Phiên & thiết bị'],
  ['audit', 'Nhật ký hoạt động'],
];

export function AdminScreen() {
  const [tab, setTab] = useState<TabKey>('users');
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  // Từ tab Người dùng: mở phiên của một người → chuyển sang tab Phiên & thiết bị.
  const viewSessions = (userId: string) => {
    setSessionUserId(userId);
    setTab('sessions');
  };

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Quản trị người dùng &amp; phân quyền</h1>
          <p className="small muted">
            Chỉ Chủ shop/Quản trị. Mọi thao tác nhạy cảm yêu cầu nhập lại mật khẩu và được ghi nhật ký.
          </p>
        </div>
      </div>

      <div className="notice notice-neutral" style={{ marginBottom: 16 }}>
        <ShieldAlert size={16} aria-hidden />
        <span className="small">
          Bảo mật thực thi ở máy chủ: dù ẩn nút ở đây, backend vẫn chặn thao tác không đủ quyền (403).
        </span>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className="tab"
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="tab-panel">
        {tab === 'users' && <UsersTab onViewSessions={viewSessions} />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'sessions' && <SessionsTab initialUserId={sessionUserId} />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
}

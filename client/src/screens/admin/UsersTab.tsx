import { useState } from 'react';
import {
  UserPlus,
  Pencil,
  Lock,
  Unlock,
  KeyRound,
  ArrowRightLeft,
  MonitorSmartphone,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../../api/client';
import type { AdminUser, AdminUsersResponse, RoleKey } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../app/AuthContext';
import { useToast } from '../../components/Toast';
import { Badge, EmptyState, ErrorState, SkeletonTable } from '../../components/ui';
import { roleVi } from '../../lib/labels';
import { fmtDateTime } from './adminLabels';
import { ReauthModal, RevokeWarning } from './ReauthModal';

const ROLE_OPTIONS: RoleKey[] = ['chu_shop', 'crm_officer', 'cskh', 'marketing', 'tro_ly_du_lieu'];

type ModalState =
  | { kind: 'create' }
  | { kind: 'edit'; user: AdminUser }
  | { kind: 'lock'; user: AdminUser }
  | { kind: 'unlock'; user: AdminUser }
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'handoff'; user: AdminUser }
  | null;

export function UsersTab({ onViewSessions }: { onViewSessions: (userId: string) => void }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const state = useApi<AdminUsersResponse>(() => api.get('/api/admin/users'), []);
  const [modal, setModal] = useState<ModalState>(null);

  const closeAndReload = (msg: string) => {
    setModal(null);
    toast('success', msg);
    state.reload();
  };

  if (state.status === 'loading') return <SkeletonTable rows={5} cols={6} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;

  const users = state.data.items;
  const activeUsers = users.filter((u) => u.status === 'active');

  return (
    <div className="stack-4">
      <div className="notice notice-danger">
        <ShieldAlert size={16} aria-hidden />
        <span className="small">
          Đổi quyền hoặc khóa người dùng sẽ <b>thu hồi TOÀN BỘ phiên &amp; thiết bị tin cậy</b> của
          người đó NGAY (ADM-01). Không xóa được user đã có thao tác — chỉ khóa (ADM-04).
        </span>
      </div>
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3 className="h3">Người dùng</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'create' })}>
          <UserPlus size={15} aria-hidden />
          Thêm người dùng
        </button>
      </div>

      {users.length === 0 ? (
        <EmptyState
          title="Chưa có người dùng nào"
          hint="Bấm 'Thêm người dùng' để tạo tài khoản đầu tiên."
        />
      ) : (
        <div className="card list-card">
          <div className="list-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Tên đăng nhập</th>
                  <th>Họ tên</th>
                  <th>Vai</th>
                  <th>Trạng thái</th>
                  <th>Đăng nhập cuối</th>
                  <th>Phiên</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td className="num">{u.username}</td>
                      <td className="wrap-anywhere">
                        <span className="row" style={{ gap: 8 }}>
                          <span className="avatar-sm" aria-hidden>
                            {u.fullName.trim().charAt(0).toUpperCase() || '?'}
                          </span>
                          {u.fullName}
                        </span>
                      </td>
                      <td>
                        <Badge tone="neutral" icon={false}>
                          {roleVi[u.roleKey] ?? u.roleKey}
                        </Badge>
                      </td>
                      <td>
                        {u.status === 'active' ? (
                          <Badge tone="success">Đang hoạt động</Badge>
                        ) : (
                          <Badge tone="danger">Đã khóa</Badge>
                        )}
                      </td>
                      <td className="num">{fmtDateTime(u.lastLoginAt)}</td>
                      <td className="num">{u.activeSessionCount}</td>
                      <td>
                        <div className="row-wrap" style={{ gap: 6 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setModal({ kind: 'edit', user: u })}
                          >
                            <Pencil size={14} aria-hidden />
                            Sửa
                          </button>
                          {u.status === 'active' ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setModal({ kind: 'lock', user: u })}
                              disabled={isSelf}
                              title={isSelf ? 'Không thể tự khóa tài khoản của mình' : undefined}
                            >
                              <Lock size={14} aria-hidden />
                              Khóa
                            </button>
                          ) : (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setModal({ kind: 'unlock', user: u })}
                            >
                              <Unlock size={14} aria-hidden />
                              Mở khóa
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setModal({ kind: 'reset', user: u })}
                          >
                            <KeyRound size={14} aria-hidden />
                            Đặt lại MK
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setModal({ kind: 'handoff', user: u })}
                          >
                            <ArrowRightLeft size={14} aria-hidden />
                            Chuyển giao
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => onViewSessions(u.id)}
                          >
                            <MonitorSmartphone size={14} aria-hidden />
                            Phiên
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal?.kind === 'create' && (
        <CreateUserModal onClose={() => setModal(null)} onDone={() => closeAndReload('Đã tạo người dùng.')} />
      )}
      {modal?.kind === 'edit' && (
        <EditUserModal
          user={modal.user}
          isSelf={modal.user.id === me?.id}
          onClose={() => setModal(null)}
          onDone={() => closeAndReload('Đã cập nhật người dùng.')}
        />
      )}
      {modal?.kind === 'lock' && (
        <ReauthModal
          title={`Khóa tài khoản ${modal.user.username}`}
          danger
          submitLabel="Khóa tài khoản"
          warning={<RevokeWarning text="Khóa tài khoản sẽ thu hồi phiên & thiết bị của người này NGAY. Nhớ chuyển giao việc trước nếu họ đang phụ trách khách." />}
          onClose={() => setModal(null)}
          onSubmit={(password) => api.post(`/api/admin/users/${modal.user.id}/lock`, { password })}
          onDone={() => closeAndReload('Đã khóa tài khoản + thu hồi phiên.')}
        />
      )}
      {modal?.kind === 'unlock' && (
        <ReauthModal
          title={`Mở khóa tài khoản ${modal.user.username}`}
          submitLabel="Mở khóa"
          onClose={() => setModal(null)}
          onSubmit={(password) => api.post(`/api/admin/users/${modal.user.id}/unlock`, { password })}
          onDone={() => closeAndReload('Đã mở khóa tài khoản.')}
        />
      )}
      {modal?.kind === 'reset' && (
        <ResetPasswordModal
          user={modal.user}
          onClose={() => setModal(null)}
          onDone={() => closeAndReload('Đã đặt lại mật khẩu + thu hồi phiên (buộc đăng nhập lại).')}
        />
      )}
      {modal?.kind === 'handoff' && (
        <HandoffModal
          user={modal.user}
          candidates={activeUsers.filter((u) => u.id !== modal.user.id)}
          onClose={() => setModal(null)}
          onDone={() => closeAndReload('Đã chuyển giao việc đang phụ trách.')}
        />
      )}
    </div>
  );
}

/* ---------- Thêm người dùng ---------- */
function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleKey, setRoleKey] = useState<RoleKey>('cskh');
  const [initialPassword, setInitialPassword] = useState('');
  // 🔴 Chính sách mật khẩu tối thiểu 8 ký tự (server cũng chặn — đây là lớp UX).
  const valid = !!username.trim() && !!fullName.trim() && initialPassword.length >= 8;

  return (
    <ReauthModal
      title="Thêm người dùng"
      submitLabel="Tạo người dùng"
      disabled={!valid}
      onClose={onClose}
      onSubmit={async (password) => {
        await api.post('/api/admin/users', {
          username: username.trim(),
          fullName: fullName.trim(),
          roleKey,
          initialPassword,
          password,
        });
      }}
      onDone={onDone}
    >
      <div className="field">
        <label className="label" htmlFor="cu-username">Tên đăng nhập</label>
        <input
          id="cu-username"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="cu-fullname">Họ tên</label>
        <input
          id="cu-fullname"
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <RoleSelect id="cu-role" value={roleKey} onChange={setRoleKey} />
      <div className="field">
        <label className="label" htmlFor="cu-initpw">Mật khẩu ban đầu</label>
        <input
          id="cu-initpw"
          className="input"
          type="password"
          value={initialPassword}
          onChange={(e) => setInitialPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
        />
        <span className="caption">Tối thiểu 8 ký tự. Người dùng nên đổi mật khẩu ở lần đăng nhập đầu.</span>
      </div>
    </ReauthModal>
  );
}

/* ---------- Sửa họ tên / vai ---------- */
function EditUserModal({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: AdminUser;
  isSelf: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [roleKey, setRoleKey] = useState<RoleKey>(user.roleKey);
  const valid = !!fullName.trim();
  const roleChanged = roleKey !== user.roleKey;

  return (
    <ReauthModal
      title={`Sửa người dùng ${user.username}`}
      submitLabel="Lưu thay đổi"
      danger={roleChanged}
      disabled={!valid}
      warning={
        roleChanged ? (
          <RevokeWarning text="Đổi vai sẽ thu hồi phiên của người này NGAY (áp quyền mới ở lần đăng nhập kế tiếp)." />
        ) : undefined
      }
      onClose={onClose}
      onSubmit={(password) =>
        api.put(`/api/admin/users/${user.id}`, {
          fullName: fullName.trim(),
          roleKey,
          password,
        })
      }
      onDone={onDone}
    >
      <div className="field">
        <label className="label" htmlFor="eu-fullname">Họ tên</label>
        <input
          id="eu-fullname"
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <RoleSelect
        id="eu-role"
        value={roleKey}
        onChange={setRoleKey}
        disabled={isSelf}
        hint={isSelf ? 'Không thể tự đổi vai của chính mình.' : undefined}
      />
    </ReauthModal>
  );
}

/* ---------- Đặt lại mật khẩu ---------- */
function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');

  return (
    <ReauthModal
      title={`Đặt lại mật khẩu ${user.username}`}
      submitLabel="Đặt lại mật khẩu"
      danger
      disabled={newPassword.length < 8}
      warning={<RevokeWarning text="Đặt lại mật khẩu sẽ thu hồi mọi phiên của người này (buộc đăng nhập lại)." />}
      onClose={onClose}
      onSubmit={(password) =>
        api.post(`/api/admin/users/${user.id}/reset-password`, { newPassword, password })
      }
      onDone={onDone}
    >
      <div className="field">
        <label className="label" htmlFor="rp-newpw">Mật khẩu mới</label>
        <input
          id="rp-newpw"
          className="input"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
        />
        <span className="caption">Tối thiểu 8 ký tự.</span>
      </div>
    </ReauthModal>
  );
}

/* ---------- Chuyển giao việc ---------- */
function HandoffModal({
  user,
  candidates,
  onClose,
  onDone,
}: {
  user: AdminUser;
  candidates: AdminUser[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [toUserId, setToUserId] = useState('');

  if (candidates.length === 0) {
    return (
      <ReauthModal
        title={`Chuyển giao việc của ${user.username}`}
        submitLabel="Đóng"
        disabled
        warning={
          <div className="notice notice-warning">
            <span className="small">
              Không có người nhận hợp lệ (cần một tài khoản khác đang hoạt động). Tạo/mở khóa người
              nhận trước.
            </span>
          </div>
        }
        onClose={onClose}
        onSubmit={async () => {}}
        onDone={onClose}
      />
    );
  }

  return (
    <ReauthModal
      title={`Chuyển giao việc của ${user.username}`}
      submitLabel="Chuyển giao"
      disabled={!toUserId}
      warning={
        <div className="notice notice-neutral">
          <span className="small">
            Chuyển các follow-up đang mở của người này sang người nhận và gỡ khóa việc họ đang giữ
            (ADM-03).
          </span>
        </div>
      }
      onClose={onClose}
      onSubmit={(password) =>
        api.post(`/api/admin/users/${user.id}/handoff`, { toUserId, password })
      }
      onDone={onDone}
    >
      <div className="field">
        <label className="label" htmlFor="ho-to">Người nhận bàn giao</label>
        <select
          id="ho-to"
          className="select"
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
        >
          <option value="">— Chọn người nhận —</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullName} ({roleVi[c.roleKey] ?? c.roleKey})
            </option>
          ))}
        </select>
      </div>
    </ReauthModal>
  );
}

/* ---------- Select vai dùng chung ---------- */
function RoleSelect({
  id,
  value,
  onChange,
  disabled,
  hint,
}: {
  id: string;
  value: RoleKey;
  onChange: (v: RoleKey) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>Vai</label>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value as RoleKey)}
        disabled={disabled}
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {roleVi[r] ?? r}
          </option>
        ))}
      </select>
      {hint && <span className="caption">{hint}</span>}
    </div>
  );
}

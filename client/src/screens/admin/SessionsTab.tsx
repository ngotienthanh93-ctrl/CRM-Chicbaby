import { useEffect, useState } from 'react';
import { Monitor, Smartphone, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { AdminSessionsResponse, AdminUsersResponse } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/Toast';
import { Badge, EmptyState, ErrorState, SkeletonCards, SkeletonTable } from '../../components/ui';
import { roleVi } from '../../lib/labels';
import { fmtDateTime } from './adminLabels';
import { ReauthModal, RevokeWarning } from './ReauthModal';

export function SessionsTab({ initialUserId }: { initialUserId: string | null }) {
  const users = useApi<AdminUsersResponse>(() => api.get('/api/admin/users'), []);
  const [userId, setUserId] = useState<string | null>(initialUserId);

  // Khi bấm "Phiên" từ tab Người dùng: đồng bộ lựa chọn.
  useEffect(() => {
    if (initialUserId) setUserId(initialUserId);
  }, [initialUserId]);

  if (users.status === 'loading') return <SkeletonCards count={2} />;
  if (users.status === 'error') return <ErrorState error={users.error} onRetry={users.reload} />;

  return (
    <div className="stack-4">
      <div className="field" style={{ maxWidth: 420 }}>
        <label className="label" htmlFor="ses-user">Chọn người dùng</label>
        <select
          id="ses-user"
          className="select"
          value={userId ?? ''}
          onChange={(e) => setUserId(e.target.value || null)}
        >
          <option value="">— Chọn người dùng —</option>
          {users.data.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName} ({roleVi[u.roleKey] ?? u.roleKey}){u.status === 'disabled' ? ' — đã khóa' : ''}
            </option>
          ))}
        </select>
      </div>

      {userId ? (
        <SessionsPanel userId={userId} />
      ) : (
        <EmptyState title="Chọn một người dùng" hint="Chọn người dùng để xem phiên đăng nhập và thiết bị tin cậy." />
      )}
    </div>
  );
}

function SessionsPanel({ userId }: { userId: string }) {
  const toast = useToast();
  const state = useApi<AdminSessionsResponse>(
    () => api.get(`/api/admin/users/${userId}/sessions`),
    [userId],
  );
  const [revokeSessionId, setRevokeSessionId] = useState<string | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);

  if (state.status === 'loading') return <SkeletonTable rows={4} cols={4} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;

  const { sessions, trustedDevices } = state.data;

  return (
    <div className="stack-4">
      <section className="card card-pad stack-2">
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 className="h3">Phiên đăng nhập đang hoạt động</h3>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setRevokeAll(true)}
            disabled={sessions.length === 0 && trustedDevices.length === 0}
          >
            <LogOut size={15} aria-hidden />
            Đăng xuất mọi thiết bị
          </button>
        </div>
        {sessions.length === 0 ? (
          <EmptyState title="Không có phiên đang hoạt động" hint="Người dùng này chưa đăng nhập hoặc đã bị thu hồi hết." />
        ) : (
          <div className="list-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Thiết bị</th>
                  <th>IP</th>
                  <th>Hoạt động cuối</th>
                  <th>Tạo lúc</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <Monitor size={14} aria-hidden className="muted" />
                        {s.device ?? 'Không rõ thiết bị'}
                      </span>
                    </td>
                    <td className="num">{s.ip ?? '—'}</td>
                    <td className="num">{fmtDateTime(s.lastSeenAt)}</td>
                    <td className="num">{fmtDateTime(s.createdAt)}</td>
                    <td>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setRevokeSessionId(s.id)}
                      >
                        Thu hồi
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad stack-2">
        <h3 className="h3">Thiết bị tin cậy</h3>
        {trustedDevices.length === 0 ? (
          <EmptyState title="Không có thiết bị tin cậy" hint="Chưa có thiết bị nào được ghi nhớ." />
        ) : (
          <div className="stack-2">
            {trustedDevices.map((d) => (
              <div key={d.id} className="card card-pad between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <Smartphone size={16} aria-hidden className="muted" />
                  <div className="stack-2" style={{ gap: 2 }}>
                    <b>{d.deviceLabel ?? 'Thiết bị không tên'}</b>
                    <span className="caption">
                      Dùng cuối: {fmtDateTime(d.lastUsedAt)} · Ghi nhớ từ {fmtDateTime(d.createdAt)}
                    </span>
                  </div>
                </div>
                <Badge tone="success">
                  <ShieldCheck size={12} aria-hidden /> Tin cậy
                </Badge>
              </div>
            ))}
          </div>
        )}
        <p className="caption">
          "Đăng xuất mọi thiết bị" thu hồi toàn bộ phiên và bỏ ghi nhớ mọi thiết bị tin cậy của người
          này.
        </p>
      </section>

      {revokeSessionId && (
        <ReauthModal
          title="Thu hồi phiên đăng nhập"
          submitLabel="Thu hồi phiên"
          danger
          warning={<RevokeWarning text="Phiên này sẽ bị đăng xuất ngay lập tức." />}
          onClose={() => setRevokeSessionId(null)}
          onSubmit={(password) => api.post(`/api/admin/sessions/${revokeSessionId}/revoke`, { password })}
          onDone={() => {
            setRevokeSessionId(null);
            toast('success', 'Đã thu hồi phiên.');
            state.reload();
          }}
        />
      )}
      {revokeAll && (
        <ReauthModal
          title="Đăng xuất mọi thiết bị"
          submitLabel="Đăng xuất tất cả"
          danger
          warning={<RevokeWarning text="Thu hồi toàn bộ phiên và bỏ ghi nhớ mọi thiết bị tin cậy của người này NGAY." />}
          onClose={() => setRevokeAll(false)}
          onSubmit={(password) => api.post(`/api/admin/users/${userId}/revoke-all`, { password })}
          onDone={() => {
            setRevokeAll(false);
            toast('success', 'Đã đăng xuất mọi thiết bị.');
            state.reload();
          }}
        />
      )}
    </div>
  );
}

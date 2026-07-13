import { useState } from 'react';
import { History, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { AuditLogsResponse } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { Badge, EmptyState, ErrorState, SkeletonTable } from '../../components/ui';
import {
  auditActionVi,
  fmtDateTime,
  objectTypeVi,
  ROLE_CHANGE_ACTIONS,
} from './adminLabels';

/** Các hành động cho phép lọc (theo 1 action/lần — hạn chế của API). */
const ACTION_FILTER_OPTIONS: string[] = [
  'user.create',
  'user.update',
  'user.role_change',
  'user.lock',
  'user.unlock',
  'user.reset_password',
  'user.handoff',
  'user.session_revoke',
  'user.revoke_all',
  'user.role_matrix.update',
];
const OBJECT_TYPE_OPTIONS: string[] = ['user', 'session', 'configuration'];

export function AuditTab() {
  const [action, setAction] = useState('');
  const [objectType, setObjectType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [roleChangesOnly, setRoleChangesOnly] = useState(false);

  const buildUrl = () => {
    const p = new URLSearchParams();
    if (roleChangesOnly) {
      // API nhận 1 action/lần; "Lịch sử đổi quyền" gồm 2 action nên lấy rộng rồi lọc client-side.
      p.set('limit', '200');
    } else {
      if (action) p.set('action', action);
      if (objectType) p.set('objectType', objectType);
      if (from) p.set('from', from);
      if (to) p.set('to', `${to}T23:59:59.999`);
      p.set('limit', '100');
    }
    return `/api/admin/audit-logs?${p.toString()}`;
  };

  const state = useApi<AuditLogsResponse>(
    () => api.get(buildUrl()),
    [action, objectType, from, to, roleChangesOnly],
  );

  const toggleRoleChanges = () => {
    const next = !roleChangesOnly;
    setRoleChangesOnly(next);
    if (next) {
      setAction('');
      setObjectType('');
    }
  };

  return (
    <div className="stack-4">
      <div className="card card-pad stack-2">
        <div className="row-wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="au-action">Hành động</label>
            <select
              id="au-action"
              className="select"
              value={action}
              disabled={roleChangesOnly}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">Tất cả hành động</option>
              {ACTION_FILTER_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {auditActionVi[a] ?? a}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="au-object">Loại đối tượng</label>
            <select
              id="au-object"
              className="select"
              value={objectType}
              disabled={roleChangesOnly}
              onChange={(e) => setObjectType(e.target.value)}
            >
              <option value="">Tất cả đối tượng</option>
              {OBJECT_TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {objectTypeVi[o] ?? o}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="au-from">Từ ngày</label>
            <input
              id="au-from"
              className="input"
              type="date"
              value={from}
              disabled={roleChangesOnly}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="au-to">Đến ngày</label>
            <input
              id="au-to"
              className="input"
              type="date"
              value={to}
              disabled={roleChangesOnly}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <button
            className={roleChangesOnly ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
            aria-pressed={roleChangesOnly}
            onClick={toggleRoleChanges}
          >
            <History size={15} aria-hidden />
            Lịch sử đổi quyền
          </button>
          {(action || objectType || from || to || roleChangesOnly) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAction('');
                setObjectType('');
                setFrom('');
                setTo('');
                setRoleChangesOnly(false);
              }}
            >
              Xóa lọc
            </button>
          )}
        </div>
        <p className="caption">
          Dữ liệu nhạy cảm đã được ẩn/che sẵn từ máy chủ (SEC-12). Nhật ký chỉ ghi thêm, không sửa/xóa.
        </p>
      </div>

      <AuditTable state={state} roleChangesOnly={roleChangesOnly} />
    </div>
  );
}

function AuditTable({
  state,
  roleChangesOnly,
}: {
  state: ReturnType<typeof useApi<AuditLogsResponse>>;
  roleChangesOnly: boolean;
}) {
  if (state.status === 'loading') return <SkeletonTable rows={6} cols={5} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;

  const items = roleChangesOnly
    ? state.data.items.filter((i) => ROLE_CHANGE_ACTIONS.includes(i.action))
    : state.data.items;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck size={26} />}
        title="Không có nhật ký khớp bộ lọc"
        hint="Thử nới bộ lọc hoặc chọn khoảng ngày khác."
      />
    );
  }

  return (
    <div className="card list-card">
      <div className="list-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Người thực hiện</th>
              <th>Hành động</th>
              <th>Đối tượng</th>
              <th>Lý do</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="num">{fmtDateTime(it.createdAt)}</td>
                <td>
                  {it.actorFullName || it.actorUsername ? (
                    <div className="stack-2" style={{ gap: 0 }}>
                      <b>{it.actorFullName ?? it.actorUsername}</b>
                      {it.actorUsername && it.actorFullName && (
                        <span className="caption num">{it.actorUsername}</span>
                      )}
                    </div>
                  ) : (
                    <span className="muted">Hệ thống</span>
                  )}
                </td>
                <td>
                  <Badge
                    tone={ROLE_CHANGE_ACTIONS.includes(it.action) ? 'primary' : 'neutral'}
                    icon={false}
                  >
                    {auditActionVi[it.action] ?? it.action}
                  </Badge>
                </td>
                <td>
                  <span className="small">{objectTypeVi[it.objectType] ?? it.objectType}</span>
                </td>
                <td className="wrap-anywhere small">{it.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from 'react';
import {
  ArrowLeft,
  Phone,
  TrendingDown,
  TrendingUp,
  Minus,
  Pause,
  PackageX,
  Search as SearchIcon,
  ArrowRightLeft,
} from 'lucide-react';
import { api } from '../api/client';
import type { OrgDetail, OrgSummary } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import {
  declineReasonVi,
  orgBadgeTone,
  orgContactRoleVi,
  orgStatusTone,
  orgStatusVi,
  vnd,
} from '../lib/labels';

export function OrganizationScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (selectedId) {
    return <OrgDetailView id={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <OrgListView onOpen={setSelectedId} />;
}

function OrgListView({ onOpen }: { onOpen: (id: string) => void }) {
  const state = useApi<{ items: OrgSummary[] }>(() => api.get('/api/organizations'), []);
  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Đại lý</h1>
          <p className="small muted">Sức khỏe quan hệ, nhịp nhập và cảnh báo nguy cơ mất.</p>
        </div>
      </div>

      {state.status === 'loading' && <SkeletonCards count={4} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState title="Chưa có đại lý" hint="Đại lý sẽ hiển thị khi có dữ liệu." />
        ) : (
          <div className="stack">
            {state.data.items.map((o) => (
              <button key={o.id} className="card card-pad stack-2 link-row" onClick={() => onOpen(o.id)} style={{ textAlign: 'left', width: '100%' }}>
                <div className="between">
                  <span className="cust-card-name link-name">{o.orgName}</span>
                  <Badge tone={orgStatusTone[o.status] ?? 'neutral'} icon={false}>
                    {orgStatusVi[o.status] ?? o.status}
                  </Badge>
                </div>
                <div className="row-wrap" style={{ gap: 8 }}>
                  {o.badges.map((b) => (
                    <Badge key={b} tone={orgBadgeTone[b] ?? 'neutral'} icon={false}>
                      {b}
                    </Badge>
                  ))}
                </div>
                <div className="work-meta">
                  <span>
                    Nhịp trung vị:{' '}
                    <b>{o.medianCadenceDays != null ? `${o.medianCadenceDays} ngày` : '—'}</b>
                    {o.cadenceSampleSize != null && ` (n=${o.cadenceSampleSize})`}
                  </span>
                  {o.lastPurchaseAt && <span>Nhập cuối: <b>{o.lastPurchaseAt}</b></span>}
                </div>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}

function OrgDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const state = useApi<OrgDetail>(() => api.get<OrgDetail>(`/api/organizations/${id}`), [id]);
  const [tab, setTab] = useState<'health' | 'contacts' | 'competition' | 'exceptions'>('health');
  const [action, setAction] = useState<null | 'status' | 'pause' | 'stockout'>(null);
  const toast = useToast();

  const investigate = async () => {
    try {
      await api.post(`/api/organizations/${id}/investigate`);
      toast('success', 'Đã tạo việc gọi tìm hiểu.');
      state.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thực hiện được.');
    }
  };

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 12 }}>
        <ArrowLeft size={16} aria-hidden />
        Danh sách đại lý
      </button>

      {state.status === 'loading' && <SkeletonCards count={3} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' && (
        <>
          <div className="card detail-head">
            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div className="stack-2" style={{ gap: 6 }}>
                <div className="detail-title">{state.data.orgName}</div>
                <div className="caption">
                  {[state.data.district, state.data.province].filter(Boolean).join(', ') || 'Chưa có địa chỉ'}
                </div>
              </div>
              <Badge tone={orgStatusTone[state.data.status] ?? 'neutral'} icon={false}>
                {orgStatusVi[state.data.status] ?? state.data.status}
              </Badge>
            </div>
            {state.data.badges.length > 0 && (
              <div className="chip-row">
                {state.data.badges.map((b) => (
                  <Badge key={b} tone={orgBadgeTone[b] ?? 'neutral'} icon={false}>
                    {b}
                  </Badge>
                ))}
              </div>
            )}
            <div className="row-wrap" style={{ gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setAction('status')}>
                <ArrowRightLeft size={15} aria-hidden />
                Chuyển trạng thái
              </button>
              {state.data.status === 'at_risk' && state.data.reasonStatus === 'unknown' && (
                <button className="btn btn-outline btn-sm" onClick={investigate}>
                  <SearchIcon size={15} aria-hidden />
                  Gọi tìm hiểu
                </button>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => setAction('pause')}>
                <Pause size={15} aria-hidden />
                Tạm dừng cảnh báo
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setAction('stockout')}>
                <PackageX size={15} aria-hidden />
                Báo shop hết hàng
              </button>
            </div>
          </div>

          <div className="tabs" role="tablist">
            {(
              [
                ['health', 'Sức khỏe quan hệ'],
                ['contacts', 'Người liên hệ'],
                ['competition', 'Cạnh tranh'],
                ['exceptions', 'Ngoại lệ'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          <div className="tab-panel">
            {tab === 'health' && <HealthTab detail={state.data} />}
            {tab === 'contacts' && <ContactsTab detail={state.data} />}
            {tab === 'competition' && <CompetitionTab detail={state.data} />}
            {tab === 'exceptions' && <ExceptionsTab detail={state.data} />}
          </div>

          {action === 'status' && (
            <StatusModal id={id} current={state.data.status} onClose={() => setAction(null)} onDone={() => { setAction(null); state.reload(); }} />
          )}
          {action === 'pause' && (
            <PauseModal id={id} onClose={() => setAction(null)} onDone={() => { setAction(null); state.reload(); }} />
          )}
          {action === 'stockout' && (
            <StockoutModal id={id} onClose={() => setAction(null)} onDone={() => { setAction(null); state.reload(); }} />
          )}
        </>
      )}
    </div>
  );
}

function HealthTab({ detail }: { detail: OrgDetail }) {
  const h = detail.health;
  const collecting = detail.status === 'collecting' || (h.cadenceSampleSize ?? 0) < 3;
  const TrendIcon = h.revenueTrend === 'down' ? TrendingDown : h.revenueTrend === 'up' ? TrendingUp : Minus;
  const trendClass = h.revenueTrend === 'down' ? 'trend-down' : h.revenueTrend === 'up' ? 'trend-up' : 'trend-flat';
  return (
    <div className="stack-4">
      {collecting && (
        <div className="disclaimer">
          Đang thu thập nhịp nhập (cần ≥3 lần nhập) — chưa đưa ra cảnh báo nguy cơ mất.
        </div>
      )}
      <div className="info-grid">
        <div className="metric">
          <span className="label">Nhịp trung vị</span>
          <span className="metric-value">{h.medianCadenceDays != null ? `${h.medianCadenceDays} ngày` : '—'}</span>
          <span className="caption">Số mẫu: n={h.cadenceSampleSize ?? 0}</span>
        </div>
        <div className="metric">
          <span className="label">Ngày nhập cuối</span>
          <span className="metric-value">{h.lastPurchaseAt ?? '—'}</span>
        </div>
        <div className="metric">
          <span className="label">Doanh số 90 ngày</span>
          <span className="metric-value num">{vnd(h.revenue90d)}</span>
          <span className="caption num">Trước đó: {vnd(h.revenuePrev90d)}</span>
        </div>
        <div className="metric">
          <span className="label">Xu hướng</span>
          <span className={`metric-value ${trendClass}`}>
            <TrendIcon size={18} aria-hidden style={{ verticalAlign: '-3px' }} />{' '}
            {h.revenueTrend === 'down' ? 'Giảm' : h.revenueTrend === 'up' ? 'Tăng' : 'Ổn định'}
          </span>
        </div>
      </div>
    </div>
  );
}

function ContactsTab({ detail }: { detail: OrgDetail }) {
  if (detail.contacts.length === 0)
    return <EmptyState title="Chưa có người liên hệ" hint="Thêm liên hệ để nhắc đúng người đặt hàng." />;
  return (
    <div className="stack">
      {detail.contacts.map((c) => (
        <div key={c.id} className="card card-pad between">
          <div className="stack-2" style={{ gap: 2 }}>
            <b>{c.name}</b>
            <div className="row" style={{ gap: 8 }}>
              <Badge tone={c.role === 'nguoi_dat_hang' ? 'primary' : 'neutral'} icon={false}>
                {orgContactRoleVi[c.role] ?? c.role}
              </Badge>
              {c.isPrimary && <span className="caption">Liên hệ chính</span>}
            </div>
          </div>
          {c.phone && (
            <span className="phone-chip">
              <Phone size={14} aria-hidden />
              {c.phone}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function CompetitionTab({ detail }: { detail: OrgDetail }) {
  const { competitorOffers, complaints } = detail.competition;
  if (!competitorOffers && !complaints)
    return <EmptyState title="Chưa có ghi nhận cạnh tranh" hint="Chào giá đối thủ / khiếu nại sẽ hiển thị tại đây." />;
  return (
    <div className="stack-4">
      {competitorOffers && (
        <div className="card card-pad stack-2">
          <h3 className="h3">Chào giá đối thủ</h3>
          <p className="wrap-anywhere">{competitorOffers}</p>
        </div>
      )}
      {complaints && (
        <div className="card card-pad stack-2">
          <h3 className="h3">Khiếu nại</h3>
          <p className="wrap-anywhere">{complaints}</p>
        </div>
      )}
    </div>
  );
}

function ExceptionsTab({ detail }: { detail: OrgDetail }) {
  const ex = detail.exceptions;
  return (
    <div className="stack-4">
      <div className="card card-pad stack-2">
        <div className="between">
          <span>Tạm nghỉ (dừng cảnh báo nhập)</span>
          <Badge tone={ex.paused ? 'attention' : 'neutral'} icon={false}>
            {ex.paused ? `Đang tạm nghỉ${ex.pausedUntil ? ` đến ${ex.pausedUntil}` : ''}` : 'Không'}
          </Badge>
        </div>
        <div className="between">
          <span>Shop hết hàng</span>
          <Badge tone={ex.supplierStockoutAffected ? 'attention' : 'neutral'} icon={false}>
            {ex.supplierStockoutAffected ? 'Có ảnh hưởng' : 'Không'}
          </Badge>
        </div>
        <p className="caption">Tạm nghỉ chỉ dừng cảnh báo NHẬP; công nợ / khiếu nại vẫn được theo dõi.</p>
      </div>
      {ex.excludedPeriods.length > 0 && (
        <div className="card card-pad stack-2">
          <h3 className="h3">Khoảng thời gian loại trừ</h3>
          {ex.excludedPeriods.map((p, i) => (
            <div key={i} className="between small">
              <span>{p.from} → {p.to}</span>
              <span className="muted">{p.reason}</span>
            </div>
          ))}
        </div>
      )}
      {detail.declineReason && (
        <div className="card card-pad between">
          <span>Lý do suy giảm đã ghi nhận</span>
          <Badge tone="warning" icon={false}>{declineReasonVi[detail.declineReason] ?? detail.declineReason}</Badge>
        </div>
      )}
    </div>
  );
}

function StatusModal({
  id,
  current,
  onClose,
  onDone,
}: {
  id: string;
  current: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [toStatus, setToStatus] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const requiresReason = toStatus === 'at_risk' || toStatus === 'lost';
  const valid = toStatus && (!requiresReason || reason);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/organizations/${id}/decline-reason`, {
        toStatus,
        declineReason: reason || undefined,
        note: note || undefined,
      });
      toast('success', 'Đã cập nhật trạng thái đại lý.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không cập nhật được.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Chuyển trạng thái đại lý"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>Lưu</button>
        </>
      }
    >
      <div className="stack-4">
        <p className="small muted">Trạng thái hiện tại: <b>{orgStatusVi[current] ?? current}</b></p>
        <div className="field">
          <label className="label" htmlFor="to-status">Trạng thái mới</label>
          <select id="to-status" className="select" value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
            <option value="">— Chọn —</option>
            <option value="active">Đang hoạt động</option>
            <option value="slow">Chậm nhịp</option>
            <option value="at_risk">Nguy cơ mất</option>
            <option value="lost">Đã mất</option>
          </select>
        </div>
        {requiresReason && (
          <div className="field">
            <label className="label" htmlFor="decline-reason">Lý do (bắt buộc)</label>
            <select id="decline-reason" className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">— Chọn lý do —</option>
              {Object.entries(declineReasonVi).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="decline-note">Ghi chú</label>
          <textarea id="decline-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function PauseModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/organizations/${id}/pause`, {
        pausedUntil: until ? new Date(until).toISOString() : undefined,
        reason: reason || undefined,
      });
      toast('success', 'Đã tạm dừng cảnh báo nhập.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thực hiện được.');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Tạm dừng cảnh báo nhập"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>Xác nhận</button>
        </>
      }
    >
      <div className="stack-4">
        <div className="field">
          <label className="label" htmlFor="pause-until">Tạm nghỉ đến ngày</label>
          <input id="pause-until" className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pause-reason">Lý do</label>
          <input id="pause-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nghỉ Tết…" />
        </div>
        <p className="caption">Chỉ dừng cảnh báo NHẬP. Công nợ / khiếu nại vẫn theo dõi.</p>
      </div>
    </Modal>
  );
}

function StockoutModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = from && to;
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/organizations/${id}/stockout`, {
        fromDate: new Date(from).toISOString(),
        toDate: new Date(to).toISOString(),
      });
      toast('success', 'Đã ghi nhận shop hết hàng.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thực hiện được.');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Báo shop hết hàng"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>Xác nhận</button>
        </>
      }
    >
      <div className="stack-4">
        <p className="small muted">Khoảng thời gian hết hàng để loại trừ cảnh báo sai.</p>
        <div className="field">
          <label className="label" htmlFor="so-from">Từ ngày</label>
          <input id="so-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="so-to">Đến ngày</label>
          <input id="so-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

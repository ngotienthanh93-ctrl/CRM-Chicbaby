import { useState } from 'react';
import {
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Webhook,
  CheckCircle2,
  CircleAlert,
  Clock,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  SyncQueueResponse,
  SyncReconResponse,
  SyncStatusResponse,
  SyncWebhooksResponse,
} from '../api/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';

type TabKey = 'status' | 'queue' | 'reconciliation' | 'webhooks';

// SLO độ trễ webhook: p95 ≤ 5 phút (SYNC / NFR).
const WEBHOOK_SLO_MS = 5 * 60 * 1000;

export function SyncScreen() {
  const { permissions } = useAuth();
  const isOwner = permissions?.role === 'chu_shop';
  const [tab, setTab] = useState<TabKey>('status');
  const [resync, setResync] = useState(false);

  const status = useApi<SyncStatusResponse>(() => api.get('/api/sync/status'), []);
  const queue = useApi<SyncQueueResponse>(() => api.get('/api/sync/queue'), []);
  const recon = useApi<SyncReconResponse>(() => api.get('/api/sync/reconciliation'), []);
  const webhooks = useApi<SyncWebhooksResponse>(() => api.get('/api/sync/webhooks'), []);

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Đồng bộ KiotViet</h1>
          <p className="small muted">
            CRM hiển thị bản mirror gần nhất — không sập khi KiotViet lỗi.
          </p>
        </div>
        {isOwner && (
          <button className="btn btn-outline" onClick={() => setResync(true)}>
            <RotateCcw size={16} aria-hidden />
            Đồng bộ lại toàn bộ
          </button>
        )}
      </div>

      <div className="notice notice-neutral" style={{ marginBottom: 16 }}>
        <ShieldAlert size={16} aria-hidden />
        <span className="small">
          Nếu KiotViet lỗi kết nối, CRM vẫn chạy trên dữ liệu đã đồng bộ và hiển thị cảnh báo — không
          mất dữ liệu quan hệ khách hàng.
        </span>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ['status', 'Trạng thái'],
            ['queue', 'Hàng đợi'],
            ['reconciliation', 'Đối soát'],
            ['webhooks', 'Webhook'],
          ] as const
        ).map(([k, label]) => (
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
        {tab === 'status' && <StatusTab state={status} />}
        {tab === 'queue' && <QueueTab state={queue} />}
        {tab === 'reconciliation' && <ReconTab state={recon} />}
        {tab === 'webhooks' && <WebhookTab state={webhooks} />}
      </div>

      {resync && (
        <FullResyncModal
          onClose={() => setResync(false)}
          onDone={() => {
            setResync(false);
            status.reload();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Trạng thái theo đối tượng ---------- */
function StatusTab({ state }: { state: ReturnType<typeof useApi<SyncStatusResponse>> }) {
  if (state.status === 'loading') return <SkeletonCards count={3} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  return (
    <div className="card list-card">
      <div className="list-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Đối tượng</th>
              <th>Đồng bộ lần cuối</th>
              <th>Số bản ghi</th>
              <th>Lỗi</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((it) => (
              <tr key={it.objectType}>
                <td>{it.label}</td>
                <td className="num">{it.lastSyncAt ?? 'Chưa đồng bộ'}</td>
                <td className="num">{it.recordCount.toLocaleString('vi-VN')}</td>
                <td>
                  {it.errorCount > 0 ? (
                    <Badge tone="danger" icon={false}>{it.errorCount} lỗi</Badge>
                  ) : (
                    <Badge tone="success" icon={false}>Sạch</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Hàng đợi + dead-letter + p95 ---------- */
function QueueTab({ state }: { state: ReturnType<typeof useApi<SyncQueueResponse>> }) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (state.status === 'loading') return <SkeletonCards count={2} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  const d = state.data;
  const p95 = d.webhookLatencyP95Ms;
  const overSlo = p95 != null && p95 > WEBHOOK_SLO_MS;

  const retry = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/api/sync/retry/${id}`);
      toast('success', 'Đã đưa sự kiện về hàng đợi để thử lại.');
      state.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thử lại được.');
      setBusyId(null);
    }
  };

  return (
    <div className="stack-4">
      <div className="dq-strip">
        <QueueStat label="Đang chờ" value={d.counts.pending ?? 0} tone="primary" />
        <QueueStat label="Đang xử lý" value={d.counts.processing ?? 0} tone="primary" />
        <QueueStat label="Lỗi (retry được)" value={d.retryable} tone="warning" />
        <QueueStat label="Dead-letter" value={d.deadLetterCount} tone="danger" />
      </div>

      <div className={`notice ${overSlo ? 'notice-warning' : 'notice-neutral'}`}>
        <Clock size={16} aria-hidden />
        <span className="small">
          Độ trễ webhook p95: <b className="num">{fmtLatency(p95)}</b> — SLO ≤ 5 phút.{' '}
          {overSlo ? 'Đang VƯỢT ngưỡng, kiểm tra kết nối KiotViet.' : 'Trong ngưỡng.'}
        </span>
      </div>

      <div>
        <div className="between" style={{ marginBottom: 8 }}>
          <h3 className="h3">Dead-letter (vượt số lần thử)</h3>
        </div>
        {d.deadLetters.length === 0 ? (
          <EmptyState title="Không có sự kiện dead-letter" hint="Hàng đợi đang sạch." />
        ) : (
          <div className="stack-2">
            {d.deadLetters.map((dl) => (
              <div key={dl.id} className="card card-pad between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div className="stack-2" style={{ gap: 2 }}>
                  <b>
                    {dl.objectType}
                    {dl.objectId ? ` · ${dl.objectId}` : ''}
                  </b>
                  <span className="caption">
                    {dl.attempts} lần thử · {dl.at}
                    {dl.errorCode ? ` · ${dl.errorCode}` : ''}
                    {dl.errorSummary ? ` · ${dl.errorSummary}` : ''}
                  </span>
                </div>
                <button
                  className="btn btn-outline btn-sm"
                  disabled={busyId === dl.id}
                  onClick={() => retry(dl.id)}
                >
                  <RefreshCw size={15} aria-hidden />
                  Thử lại
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QueueStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const kpi = tone === 'danger' ? 'kpi-danger' : tone === 'warning' ? 'kpi-warning' : 'kpi-primary';
  return (
    <div className={`card kpi ${kpi}`}>
      <span className="kpi-value num">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

/* ---------- Đối soát ---------- */
function ReconTab({ state }: { state: ReturnType<typeof useApi<SyncReconResponse>> }) {
  if (state.status === 'loading') return <SkeletonCards count={2} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  return (
    <div className="stack-4">
      <p className="caption">{state.data.note}</p>
      {state.data.items.length === 0 ? (
        <EmptyState title="Chưa có bản đối soát" hint="Đối soát chạy theo lịch (T-1 và hôm nay)." />
      ) : (
        <div className="card list-card">
          <div className="list-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Đối tượng</th>
                  <th>KiotViet</th>
                  <th>CRM</th>
                  <th>Lệch</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((r, i) => {
                  const isT1 = r.periodLabel === 'T-1';
                  return (
                    <tr key={i}>
                      <td>
                        <Badge tone={isT1 ? 'neutral' : 'primary'} icon={false}>
                          {isT1 ? 'T-1' : 'Hôm nay'}
                        </Badge>
                      </td>
                      <td>{r.objectType}</td>
                      <td className="num">{r.kvCount}</td>
                      <td className="num">{r.crmCount}</td>
                      <td className="num">{r.mismatch ?? 0}</td>
                      <td>
                        {r.matched ? (
                          <Badge tone="success" icon={false}>Khớp</Badge>
                        ) : isT1 ? (
                          <Badge tone="danger" icon={false}>Lệch (cần xử lý)</Badge>
                        ) : (
                          <Badge tone="attention" icon={false}>Lệch do timing</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="caption">
        Kỳ T-1 phải KHỚP TUYỆT ĐỐI. Kỳ hôm nay cho phép lệch nhẹ do sự kiện đang trên đường đồng bộ.
      </p>
    </div>
  );
}

/* ---------- Webhook ---------- */
function WebhookTab({ state }: { state: ReturnType<typeof useApi<SyncWebhooksResponse>> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (state.status === 'loading') return <SkeletonCards count={2} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;

  const register = async () => {
    setBusy(true);
    try {
      await api.post('/api/sync/webhooks/register');
      toast('success', 'Đã đăng ký lại webhook.');
      state.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không đăng ký được.');
      setBusy(false);
    }
  };

  const hasInactive = state.data.webhooks.some((w) => w.status !== 'active');

  return (
    <div className="stack-4">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <Webhook size={16} aria-hidden className="muted" />
          <span>
            Trạng thái đăng ký:{' '}
            {state.data.registered ? (
              <Badge tone="success" icon={false}>Đã đăng ký</Badge>
            ) : (
              <Badge tone="danger" icon={false}>Chưa đăng ký</Badge>
            )}
          </span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={register} disabled={busy}>
          <RefreshCw size={15} aria-hidden />
          Đăng ký lại webhook
        </button>
      </div>

      {state.data.webhooks.length === 0 ? (
        <EmptyState title="Chưa có webhook nào" hint="Bấm 'Đăng ký lại webhook' để thiết lập." />
      ) : (
        <div className="stack-2">
          {state.data.webhooks.map((w) => (
            <div key={w.objectType} className="card card-pad between">
              <b>{w.objectType}</b>
              {w.status === 'active' ? (
                <Badge tone="success" icon={false}>
                  <CheckCircle2 size={12} aria-hidden /> Đang hoạt động
                </Badge>
              ) : (
                <Badge tone="warning" icon={false}>
                  <CircleAlert size={12} aria-hidden /> Không hoạt động
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
      {hasInactive && (
        <p className="caption">Có webhook không hoạt động — đăng ký lại để nhận sự kiện realtime.</p>
      )}
    </div>
  );
}

/* ---------- Full resync (🔴 chủ shop + xác nhận + mật khẩu) ---------- */
function FullResyncModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = password.length > 0 && confirm;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/sync/full-resync', { password, confirm: true });
      toast('success', 'Đã lên lịch đồng bộ lại toàn bộ.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không chạy được, kiểm tra mật khẩu.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Đồng bộ lại toàn bộ"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button className="btn btn-danger" onClick={submit} disabled={!valid || busy}>
            {busy ? 'Đang chạy…' : 'Chạy đồng bộ lại'}
          </button>
        </>
      }
    >
      <div className="stack-4">
        <div className="notice notice-warning">
          <ShieldAlert size={16} aria-hidden />
          <span className="small">
            Nên chạy NGOÀI giờ cao điểm. Thao tác KHÔNG nhân đôi và KHÔNG mất dữ liệu CRM (chỉ nạp lại
            mirror KiotViet).
          </span>
        </div>
        <label className="check">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>Tôi hiểu và muốn chạy đồng bộ lại toàn bộ.</span>
        </label>
        <div className="field">
          <label className="label" htmlFor="resync-pw">
            Nhập lại mật khẩu để xác minh
          </label>
          <input
            id="resync-pw"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </div>
    </Modal>
  );
}

function fmtLatency(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} giây`;
  return `${(s / 60).toFixed(1)} phút`;
}

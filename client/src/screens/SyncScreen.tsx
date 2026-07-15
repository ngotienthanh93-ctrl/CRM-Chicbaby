import { useState } from 'react';
import {
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Webhook,
  CheckCircle2,
  CircleAlert,
  Clock,
  KeyRound,
  PlugZap,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  SyncQueueResponse,
  SyncReconResponse,
  SyncStatusResponse,
  SyncWebhooksResponse,
  SyncPublicApiCredsStatus,
  SyncTestConnectionResult,
} from '../api/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';

type TabKey = 'connection' | 'status' | 'queue' | 'reconciliation' | 'webhooks';

// SLO độ trễ webhook: p95 ≤ 5 phút (SYNC / NFR).
const WEBHOOK_SLO_MS = 5 * 60 * 1000;

export function SyncScreen() {
  const { permissions } = useAuth();
  const isOwner = permissions?.role === 'chu_shop';
  const [tab, setTab] = useState<TabKey>('connection');
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
            ['connection', 'Kết nối'],
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
        {tab === 'connection' && <ConnectionTab isOwner={isOwner} />}
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
  const totalErrors = state.data.items.reduce((s, it) => s + it.errorCount, 0);
  return (
    <div className="stack-4">
      <div className={`notice ${totalErrors > 0 ? 'notice-warning' : 'notice-success'}`}>
        {totalErrors > 0 ? <CircleAlert size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
        <span className="small">
          {totalErrors > 0
            ? `Có ${totalErrors} lỗi đồng bộ cần xử lý — xem chi tiết bên dưới.`
            : 'Kết nối bình thường — mọi đối tượng đã đồng bộ sạch.'}
        </span>
      </div>
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
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={`sync-dot ${it.errorCount > 0 ? 'is-error' : 'is-ok'}`} aria-hidden />
                      {it.label}
                    </span>
                  </td>
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

/* ---------- Kết nối KiotViet Public API (pull) — KV-01/02 ---------- */
function ConnectionTab({ isOwner }: { isOwner: boolean }) {
  const toast = useToast();
  const creds = useApi<SyncPublicApiCredsStatus>(
    () => api.get('/api/sync/public-api-credentials'),
    [],
  );
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SyncTestConnectionResult | null>(null);

  if (creds.status === 'loading') return <SkeletonCards count={2} />;
  if (creds.status === 'error') return <ErrorState error={creds.error} onRetry={creds.reload} />;
  const d = creds.data;

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post<SyncTestConnectionResult>('/api/sync/public-api/test-connection');
      setTestResult(r);
      if (r.tokenOk && r.apiOk) toast('success', 'Kết nối KiotViet thành công.');
      else toast('error', r.error ?? 'Kết nối chưa thành công.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không kiểm tra được kết nối.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="stack-4">
      <div className={`notice ${d.configured ? 'notice-success' : 'notice-warning'}`}>
        {d.configured ? <CheckCircle2 size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
        <span className="small">
          {d.configured
            ? 'Đã cấu hình credential KiotViet Public API. Bấm "Kiểm tra kết nối" để xác nhận còn hiệu lực.'
            : 'Chưa cấu hình kết nối KiotViet. Nhập Client ID / Client Secret / Tên shop để bắt đầu đồng bộ.'}
        </span>
      </div>

      <div className="card card-pad stack-3">
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <KeyRound size={16} aria-hidden className="muted" />
            <b>Kết nối Public API (pull)</b>
          </div>
          {d.configured ? (
            <Badge tone="success" icon={false}>Đã cấu hình</Badge>
          ) : (
            <Badge tone="danger" icon={false}>Chưa cấu hình</Badge>
          )}
        </div>
        <div className="stack-2">
          <div className="between">
            <span className="muted small">Tên shop (Retailer)</span>
            <span>{d.retailer ?? '—'}</span>
          </div>
          <div className="between">
            <span className="muted small">Client ID</span>
            <span className="num">{d.clientIdMasked ?? '—'}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {isOwner && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
              <KeyRound size={15} aria-hidden />
              {d.configured ? 'Đổi credential' : 'Thiết lập kết nối'}
            </button>
          )}
          <button
            className="btn btn-outline btn-sm"
            onClick={test}
            disabled={testing || !d.configured}
          >
            <PlugZap size={15} aria-hidden />
            {testing ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
          </button>
        </div>
        {!isOwner && (
          <p className="caption">Chỉ Chủ shop được nhập/đổi credential. Bạn có thể kiểm tra kết nối.</p>
        )}
        {testResult && (
          <div
            className={`notice ${testResult.tokenOk && testResult.apiOk ? 'notice-success' : 'notice-warning'}`}
          >
            {testResult.tokenOk && testResult.apiOk ? (
              <CheckCircle2 size={16} aria-hidden />
            ) : (
              <CircleAlert size={16} aria-hidden />
            )}
            <span className="small">
              Xác thực token: <b>{testResult.tokenOk ? 'OK' : 'Thất bại'}</b> · Gọi API:{' '}
              <b>{testResult.apiOk ? 'OK' : 'Thất bại'}</b>
              {testResult.error ? ` · ${testResult.error}` : ''}
            </span>
          </div>
        )}
      </div>

      <p className="caption">
        Lấy Client ID / Client Secret trong KiotViet: <b>Thiết lập cửa hàng → Kết nối API / Ứng dụng</b>.
        Tên shop (Retailer) là mã cửa hàng khi đăng nhập KiotViet. Credential được mã hóa khi lưu, không
        hiển thị lại.
      </p>

      {editing && (
        <CredentialsModal
          configured={d.configured}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            setTestResult(null);
            creds.reload();
          }}
        />
      )}
    </div>
  );
}

function CredentialsModal({
  configured,
  onClose,
  onDone,
}: {
  configured: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [retailer, setRetailer] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const valid =
    clientId.trim().length > 0 &&
    clientSecret.trim().length > 0 &&
    retailer.trim().length > 0 &&
    password.length > 0;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/sync/public-api-credentials', {
        clientId: clientId.trim(),
        clientSecret,
        retailer: retailer.trim(),
        password,
      });
      toast('success', 'Đã lưu credential KiotViet.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không lưu được — kiểm tra dữ liệu / mật khẩu.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={configured ? 'Đổi credential KiotViet' : 'Thiết lập kết nối KiotViet'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>
            {busy ? 'Đang lưu…' : 'Lưu kết nối'}
          </button>
        </>
      }
    >
      <div className="stack-4">
        <div className="notice notice-neutral">
          <ShieldAlert size={16} aria-hidden />
          <span className="small">
            Client Secret được mã hóa khi lưu và KHÔNG hiển thị lại. Cần nhập lại mật khẩu để xác minh.
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="kv-client-id">
            Client ID
          </label>
          <input
            id="kv-client-id"
            className="input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
            placeholder="Từ KiotViet → Kết nối API"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="kv-client-secret">
            Client Secret
          </label>
          <input
            id="kv-client-secret"
            className="input"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="kv-retailer">
            Tên shop (Retailer)
          </label>
          <input
            id="kv-retailer"
            className="input"
            value={retailer}
            onChange={(e) => setRetailer(e.target.value)}
            autoComplete="off"
            placeholder="vd: chicbabyshop"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="kv-reauth-pw">
            Nhập lại mật khẩu để xác minh
          </label>
          <input
            id="kv-reauth-pw"
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

// 🔴 SCR Export dữ liệu có DUYỆT: người có quyền xem dữ liệu nhạy cảm ĐỀ XUẤT → CHỦ SHOP duyệt/từ chối/thu hồi
// (nhập lại mật khẩu) → người đề xuất/chủ shop TẢI trong hạn (mỗi lần tải server tự ghi audit).
// RBAC ẩn nút ở UI cho gọn, nhưng SERVER mới là nơi chặn thật (marketing/trợ lý dữ liệu ⇒ 403).
import { useState } from 'react';
import { CheckCircle2, Download, FileDown, Send, ShieldAlert, XCircle, Ban } from 'lucide-react';
import { api } from '../api/client';
import type {
  ExportDatasetScope,
  ExportDownloadResponse,
  ExportRequestDto,
  ExportsResponse,
} from '../api/types';
import type { Tone } from '../lib/labels';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import { ReauthModal } from './admin/ReauthModal';
import { fmtDateTime } from './admin/adminLabels';

const SCOPE_LABEL: Record<ExportDatasetScope, string> = {
  customers: 'Khách hàng',
  babies: 'Hồ sơ bé',
};

const STATE_LABEL: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  expired: 'Đã hết hạn',
  revoked: 'Đã thu hồi',
};

const STATE_TONE: Record<string, Tone> = {
  pending: 'attention',
  approved: 'success',
  rejected: 'neutral',
  expired: 'warning',
  revoked: 'danger',
};

type ModalState = { kind: 'approve' | 'reject' | 'revoke'; item: ExportRequestDto } | null;

export function ExportScreen() {
  const { user, permissions } = useAuth();
  const toast = useToast();
  const state = useApi<ExportsResponse>(() => api.get('/api/exports'), []);
  const [modal, setModal] = useState<ModalState>(null);

  const canApprove = permissions?.approveExport ?? false;

  const closeAndReload = (msg: string) => {
    setModal(null);
    toast('success', msg);
    state.reload();
  };

  // Tải JSON về máy: dùng api.get (đã kèm credentials) rồi tạo Blob + trigger download.
  const download = async (item: ExportRequestDto) => {
    try {
      const data = await api.get<ExportDownloadResponse>(`/api/exports/${item.id}/download`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${data.datasetScope}-${item.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(
        'success',
        `Đã tải ${data.rowCount} dòng${data.capped ? ' (đã cắt theo trần)' : ''}. Lần tải này được ghi nhật ký.`,
      );
      state.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không tải được dữ liệu.');
    }
  };

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Export dữ liệu</h1>
          <p className="small muted">
            Xuất dữ liệu khách/bé BẮT BUỘC có duyệt của chủ shop và được ghi nhật ký. Mỗi lần tải đều
            lưu vết truy cập.
          </p>
        </div>
      </div>

      <div className="notice notice-neutral" style={{ marginBottom: 16 }}>
        <ShieldAlert size={16} aria-hidden />
        <span className="small">
          Chỉ chủ shop được duyệt, từ chối hoặc thu hồi yêu cầu. Bảo mật thực thi ở máy chủ (403 nếu
          không đủ quyền) — ẩn nút chỉ để giao diện gọn.
        </span>
      </div>

      <CreateExportForm
        onCreated={() => {
          toast('success', 'Đã gửi yêu cầu export. Chờ chủ shop duyệt.');
          state.reload();
        }}
      />

      <h3 className="h3" style={{ margin: '20px 0 12px' }}>
        Yêu cầu export
      </h3>

      {state.status === 'loading' && <SkeletonCards count={3} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState
            icon={<FileDown size={26} />}
            title="Chưa có yêu cầu export nào"
            hint="Tạo yêu cầu ở trên; chủ shop sẽ duyệt trước khi tải được."
          />
        ) : (
          <div className="stack">
            {state.data.items.map((item) => (
              <ExportCard
                key={item.id}
                item={item}
                mine={item.requestedBy === user?.id}
                canApprove={canApprove}
                onDownload={() => download(item)}
                onApprove={() => setModal({ kind: 'approve', item })}
                onReject={() => setModal({ kind: 'reject', item })}
                onRevoke={() => setModal({ kind: 'revoke', item })}
              />
            ))}
          </div>
        ))}

      {modal?.kind === 'approve' && (
        <ReauthModal
          title="Duyệt yêu cầu export"
          submitLabel="Duyệt export"
          warning={
            <div className="notice notice-warning">
              <ShieldAlert size={16} aria-hidden />
              <span className="small">
                Duyệt sẽ mở quyền tải dữ liệu <b>{SCOPE_LABEL[modal.item.datasetScope]}</b> trong thời
                hạn cấu hình. Thao tác này được ghi nhật ký.
              </span>
            </div>
          }
          onClose={() => setModal(null)}
          onSubmit={(password) => api.post(`/api/exports/${modal.item.id}/approve`, { password })}
          onDone={() => closeAndReload('Đã duyệt yêu cầu export.')}
        />
      )}
      {modal?.kind === 'reject' && (
        <ReauthModal
          title="Từ chối yêu cầu export"
          submitLabel="Từ chối export"
          danger
          warning={
            <div className="notice notice-warning">
              <ShieldAlert size={16} aria-hidden />
              <span className="small">
                Từ chối yêu cầu export <b>{SCOPE_LABEL[modal.item.datasetScope]}</b>. Thao tác này được
                ghi nhật ký.
              </span>
            </div>
          }
          onClose={() => setModal(null)}
          onSubmit={(password) => api.post(`/api/exports/${modal.item.id}/reject`, { password })}
          onDone={() => closeAndReload('Đã từ chối yêu cầu export.')}
        />
      )}
      {modal?.kind === 'revoke' && (
        <ReauthModal
          title="Thu hồi yêu cầu export"
          submitLabel="Thu hồi"
          danger
          warning={
            <div className="notice notice-warning">
              <ShieldAlert size={16} aria-hidden />
              <span className="small">
                Thu hồi cắt quyền tải NGAY kể cả khi còn hạn. Thao tác này được ghi nhật ký.
              </span>
            </div>
          }
          onClose={() => setModal(null)}
          onSubmit={(password) => api.post(`/api/exports/${modal.item.id}/revoke`, { password })}
          onDone={() => closeAndReload('Đã thu hồi yêu cầu export.')}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/** Form ĐỀ XUẤT export: chọn phạm vi + nhập lý do (bắt buộc). */
function CreateExportForm({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [scope, setScope] = useState<ExportDatasetScope>('customers');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = reason.trim().length > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/exports', { datasetScope: scope, reason: reason.trim() });
      setReason('');
      setScope('customers');
      onCreated();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không tạo được yêu cầu export.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad stack-4">
      <h3 className="h3">Tạo yêu cầu export</h3>
      <div className="field">
        <span className="label">Phạm vi dữ liệu</span>
        <div className="segmented" role="group" aria-label="Phạm vi dữ liệu">
          <button type="button" aria-pressed={scope === 'customers'} onClick={() => setScope('customers')}>
            Khách hàng
          </button>
          <button type="button" aria-pressed={scope === 'babies'} onClick={() => setScope('babies')}>
            Hồ sơ bé
          </button>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="export-reason">
          Lý do export <span className="req">*</span>
        </label>
        <textarea
          id="export-reason"
          className="textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Bắt buộc — vì sao cần xuất dữ liệu này"
        />
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
          <Send size={16} aria-hidden />
          {busy ? 'Đang gửi…' : 'Gửi yêu cầu duyệt'}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
function ExportCard({
  item,
  mine,
  canApprove,
  onDownload,
  onApprove,
  onReject,
  onRevoke,
}: {
  item: ExportRequestDto;
  mine: boolean;
  canApprove: boolean;
  onDownload: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRevoke: () => void;
}) {
  return (
    <article className="card card-pad stack-2">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={STATE_TONE[item.effectiveState] ?? 'neutral'} icon={false}>
            {STATE_LABEL[item.effectiveState] ?? item.effectiveState}
          </Badge>
          <Badge tone="primary" icon={false}>
            {SCOPE_LABEL[item.datasetScope]}
          </Badge>
          <Badge tone="neutral" icon={false}>{mine ? 'Bạn tạo' : 'Người khác tạo'}</Badge>
        </div>
        <span className="caption">Tạo lúc {fmtDateTime(item.createdAt)}</span>
      </div>

      <p className="small wrap-anywhere">
        <b>Lý do:</b> {item.reason}
      </p>

      <div className="row-wrap" style={{ gap: 12 }}>
        <span className="caption">Số lần tải: {item.downloadCount}</span>
        {item.expiresAt && <span className="caption">Hạn tải: {fmtDateTime(item.expiresAt)}</span>}
        {item.revokedAt && <span className="caption">Thu hồi lúc: {fmtDateTime(item.revokedAt)}</span>}
      </div>

      <div className="row-wrap" style={{ gap: 8 }}>
        {item.downloadable && (
          <button className="btn btn-primary btn-sm" onClick={onDownload}>
            <Download size={15} aria-hidden />
            Tải
          </button>
        )}
        {canApprove && item.effectiveState === 'pending' && (
          <>
            <button className="btn btn-outline btn-sm" onClick={onApprove}>
              <CheckCircle2 size={15} aria-hidden />
              Duyệt
            </button>
            <button className="btn btn-outline btn-sm" onClick={onReject}>
              <XCircle size={15} aria-hidden />
              Từ chối
            </button>
          </>
        )}
        {canApprove && item.effectiveState === 'approved' && (
          <button className="btn btn-outline btn-sm" onClick={onRevoke}>
            <Ban size={15} aria-hidden />
            Thu hồi
          </button>
        )}
      </div>
    </article>
  );
}


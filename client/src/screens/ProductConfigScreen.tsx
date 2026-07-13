import { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Wand2 } from 'lucide-react';
import { api } from '../api/client';
import type { DataQualityReport, Product } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonTable } from '../components/ui';
import { babyModeVi, confidenceVi } from '../lib/labels';

export function ProductConfigScreen() {
  const { permissions } = useAuth();
  const state = useApi<{ items: Product[] }>(() => api.get('/api/products'), []);
  const dq = useApi<DataQualityReport>(() => api.get('/api/reports/data-quality'), []);

  const canEditMeta = permissions?.role === 'chu_shop' || permissions?.role === 'crm_officer';
  const canApprove = permissions?.approveCycle ?? false;

  const groups = useMemo(() => {
    const map = new Map<string, string>();
    if (state.status === 'success') {
      for (const p of state.data.items) {
        if (p.replacementGroup) map.set(p.replacementGroup.id, p.replacementGroup.name);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [state]);

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Cấu hình chu kỳ sản phẩm</h1>
          <p className="small muted">
            Chỉ chu kỳ ĐÃ DUYỆT được dùng để tính nhắc. Chỉ chủ shop duyệt được.
          </p>
        </div>
      </div>

      {dq.status === 'success' && dq.data.productsNeedCycle > 0 && (
        <div className="notice notice-warning" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} aria-hidden />
          <span className="small">
            <b className="num">{dq.data.productsNeedCycle}</b> sản phẩm chưa duyệt chu kỳ — CHƯA nhắc
            tái mua được cho các SP này.
          </span>
        </div>
      )}

      {dq.status === 'success' && (
        <div className="dq-strip">
          <DqCard label="SP cần khai chu kỳ" value={dq.data.productsNeedCycle} tone="warning" />
          <DqCard label="Dòng phân bổ cần soát" value={dq.data.allocationsNeedReview} tone="attention" />
          <DqCard label="Bé thiếu tuổi" value={dq.data.babiesMissingAge} tone="neutral" />
          <DqCard label="Khách thiếu consent" value={dq.data.customersMissingConsent} tone="neutral" />
        </div>
      )}

      {!canApprove && (
        <p className="caption" style={{ marginBottom: 12 }}>
          Bạn có thể đề xuất chế độ gắn bé và bật nhắc; chỉ chủ shop mới DUYỆT được chu kỳ chính thức.
        </p>
      )}

      {state.status === 'loading' && <SkeletonTable rows={6} cols={5} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState title="Chưa có sản phẩm" hint="Sản phẩm đồng bộ từ KiotViet sẽ hiển thị tại đây." />
        ) : (
          <div className="stack-2">
            <div className="card list-card">
              <div className="list-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Chế độ gắn bé</th>
                      <th>Chu kỳ gợi ý</th>
                      <th>Chu kỳ duyệt</th>
                      <th>Nhóm thay thế</th>
                      <th>Nhắc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((p) => (
                      <ProductRow
                        key={p.kvProductId}
                        product={p}
                        groups={groups}
                        canEditMeta={canEditMeta}
                        canApprove={canApprove}
                        onChanged={() => {
                          state.reload();
                          dq.reload();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="caption">
              Chu kỳ = số ngày dùng hết MỘT đơn vị (1 lon / 1 hộp) — hệ thống nhân với số lượng để
              ước lượng ngày hết.
            </p>
          </div>
        ))}
    </div>
  );
}

function DqCard({ label, value, tone }: { label: string; value: number; tone: 'warning' | 'attention' | 'neutral' }) {
  return (
    <div className={`card kpi kpi-${tone === 'warning' ? 'warning' : tone === 'attention' ? 'warning' : 'primary'}`}>
      <span className="kpi-value num">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function ProductRow({
  product,
  groups,
  canEditMeta,
  canApprove,
  onChanged,
}: {
  product: Product;
  groups: { id: string; name: string }[];
  canEditMeta: boolean;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [cycle, setCycle] = useState(product.approvedCycleDays != null ? String(product.approvedCycleDays) : '');
  const [confirming, setConfirming] = useState<{ days: number; affected: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const putMeta = async (patch: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await api.put(`/api/products/${product.kvProductId}/meta`, patch);
      toast('success', okMsg);
      onChanged();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không lưu được.');
    } finally {
      setBusy(false);
    }
  };

  const startApprove = async () => {
    const days = Number(cycle);
    if (!days || days <= 0) {
      toast('error', 'Chu kỳ phải là số ngày dương.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ affectedAllocations: number }>(
        `/api/products/${product.kvProductId}/approve-cycle`,
        { approvedCycleDays: days, preview: true },
      );
      setConfirming({ days, affected: res.affectedAllocations });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không xem trước được.');
    } finally {
      setBusy(false);
    }
  };

  const doApprove = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      await api.post(`/api/products/${product.kvProductId}/approve-cycle`, {
        approvedCycleDays: confirming.days,
      });
      toast('success', 'Đã duyệt chu kỳ. Nhắc sẽ tính theo giá trị này.');
      setConfirming(null);
      onChanged();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không duyệt được.');
      setBusy(false);
    }
  };

  return (
    <tr className={product.needsApproval ? 'needs-approval-row' : undefined}>
      <td>
        <div className="stack-2" style={{ gap: 2 }}>
          <b>{product.name}</b>
          <span className="caption">{product.code}</span>
          {product.needsApproval && (
            <Badge tone="warning">Chưa duyệt chu kỳ</Badge>
          )}
        </div>
      </td>
      <td>
        <select
          className="select cell-input"
          style={{ width: 140 }}
          value={product.babyAssignmentMode}
          disabled={!canEditMeta || busy}
          onChange={(e) => putMeta({ babyAssignmentMode: e.target.value }, 'Đã cập nhật chế độ gắn bé.')}
        >
          {Object.entries(babyModeVi).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </td>
      <td>
        {product.suggestedCycleDays != null ? (
          <div className="stack-2" style={{ gap: 2 }}>
            <span className="cell-num">
              {product.suggestedCycleDays} ngày
              {product.suggestionSampleSize != null && ` (n=${product.suggestionSampleSize})`}
            </span>
            {product.suggestionConfidence && (
              <span className="caption">{confidenceVi[product.suggestionConfidence] ?? product.suggestionConfidence}</span>
            )}
            {canApprove && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCycle(String(product.suggestedCycleDays))}
              >
                <Wand2 size={14} aria-hidden />
                Dùng gợi ý
              </button>
            )}
          </div>
        ) : (
          <span className="caption">Chưa có gợi ý</span>
        )}
      </td>
      <td>
        {canApprove ? (
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input cell-input"
              type="number"
              min={1}
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
              aria-label={`Chu kỳ duyệt cho ${product.name}`}
            />
            <button className="btn btn-primary btn-sm" onClick={startApprove} disabled={busy}>
              Duyệt
            </button>
          </div>
        ) : (
          <span className="cell-num">
            {product.approvedCycleDays != null ? `${product.approvedCycleDays} ngày` : '— chưa duyệt'}
          </span>
        )}
      </td>
      <td>
        <select
          className="select cell-input"
          style={{ width: 130 }}
          value={product.replacementGroup?.id ?? ''}
          disabled={!canEditMeta || busy}
          onChange={(e) =>
            putMeta({ replacementGroupId: e.target.value || null }, 'Đã cập nhật nhóm thay thế.')
          }
        >
          <option value="">Không nhóm</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </td>
      <td>
        <label className="check" style={{ minHeight: 'auto' }}>
          <input
            type="checkbox"
            checked={product.autoRemindEnabled}
            disabled={!canEditMeta || busy}
            onChange={(e) => putMeta({ autoRemindEnabled: e.target.checked }, 'Đã cập nhật bật nhắc.')}
          />
          <span className="caption">{product.autoRemindEnabled ? 'Bật' : 'Tắt'}</span>
        </label>
      </td>

      {confirming && (
        <Modal
          title="Duyệt chu kỳ sản phẩm"
          onClose={() => setConfirming(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setConfirming(null)}>Hủy</button>
              <button className="btn btn-primary" onClick={doApprove} disabled={busy}>
                <CheckCircle2 size={16} aria-hidden />
                Xác nhận duyệt
              </button>
            </>
          }
        >
          <div className="stack-2">
            <p>
              Duyệt chu kỳ <b>{confirming.days} ngày</b> cho <b>{product.name}</b>.
            </p>
            <div className="disclaimer">
              <AlertTriangle size={16} aria-hidden />
              <span>
                Ảnh hưởng khoảng <b>{confirming.affected}</b> dòng phân bổ sẽ dùng chu kỳ này để tính
                ngày nhắc.
              </span>
            </div>
          </div>
        </Modal>
      )}
    </tr>
  );
}

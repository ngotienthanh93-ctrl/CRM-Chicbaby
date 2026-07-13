import { useState } from 'react';
import { ArrowLeft, GitMerge, ShieldAlert, Users, X } from 'lucide-react';
import { api } from '../api/client';
import type { DedupPair, DedupResponse, MergePreview } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import { consentStatusVi, consentTypeVi } from '../lib/labels';

const FIELD_LABEL: Record<string, string> = {
  fullName: 'Họ tên đầy đủ',
  displayName: 'Tên hiển thị',
  facebook: 'Facebook',
  zalo: 'Zalo',
  careAddress: 'Địa chỉ chăm sóc',
};

const RESOLUTION_LABEL: Record<string, string> = {
  giu_master: 'Giữ của khách GIỮ',
  dung_merged: 'Lấy từ khách gộp',
  ca_hai_trong: 'Cả hai đều trống',
};

export function MergeScreen() {
  const [pair, setPair] = useState<{ masterId: string; mergedId: string; label: string } | null>(null);
  if (pair) {
    return (
      <MergeResolve
        initial={pair}
        onBack={() => setPair(null)}
        onMerged={() => setPair(null)}
      />
    );
  }
  return <DedupList onOpen={setPair} />;
}

/* ------------------------------------------------------------------ */
function DedupList({
  onOpen,
}: {
  onOpen: (p: { masterId: string; mergedId: string; label: string }) => void;
}) {
  const toast = useToast();
  const state = useApi<DedupResponse>(() => api.get('/api/customers/dedup-candidates'), []);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const pairKey = (p: DedupPair) => `${p.a.id}__${p.b.id}`;

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Gộp khách nghi trùng</h1>
          <p className="small muted">
            Chỉ chủ shop duyệt. KHÔNG bao giờ gợi ý chỉ vì trùng tên; chung số điện thoại khác tên
            (gia đình) không gợi ý.
          </p>
        </div>
      </div>

      {state.status === 'loading' && <SkeletonCards count={3} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (() => {
          const items = state.data.items.filter((p) => !dismissed.has(pairKey(p)));
          if (items.length === 0)
            return (
              <EmptyState
                icon={<Users size={26} />}
                title="Không có cặp khách nghi trùng"
                hint={state.data.note}
              />
            );
          return (
            <div className="stack">
              <p className="caption">
                Ngưỡng gợi ý: điểm ≥ {state.data.threshold}. {state.data.note}
              </p>
              {items.map((p) => (
                <article key={pairKey(p)} className="card card-pad stack-2">
                  <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Badge tone={p.score >= 100 ? 'danger' : 'warning'} icon={false}>
                        Điểm {p.score}
                      </Badge>
                      {p.reasons.map((r) => (
                        <Badge key={r} tone="neutral" icon={false}>{r}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="merge-parties">
                    <PartyMini title="Khách A" name={p.a.displayName} phone={p.a.phone} />
                    <PartyMini title="Khách B" name={p.b.displayName} phone={p.b.phone} />
                  </div>
                  <div className="row-wrap" style={{ gap: 8 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        onOpen({
                          masterId: p.a.id,
                          mergedId: p.b.id,
                          label: `${p.a.displayName} ↔ ${p.b.displayName}`,
                        })
                      }
                    >
                      <GitMerge size={15} aria-hidden />
                      Xem & giải quyết
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setDismissed((prev) => new Set(prev).add(pairKey(p)));
                        toast('info', 'Đã bỏ qua cặp này (không phải trùng).');
                      }}
                    >
                      <X size={15} aria-hidden />
                      Không phải trùng
                    </button>
                  </div>
                </article>
              ))}
            </div>
          );
        })()}
    </div>
  );
}

function PartyMini({ title, name, phone }: { title: string; name: string; phone: string | null }) {
  return (
    <div className="merge-party">
      <span className="caption">{title}</span>
      <b className="wrap-anywhere">{name}</b>
      <span className="num small muted">{phone ?? '—'}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function MergeResolve({
  initial,
  onBack,
  onMerged,
}: {
  initial: { masterId: string; mergedId: string; label: string };
  onBack: () => void;
  onMerged: () => void;
}) {
  const toast = useToast();
  const [masterId, setMasterId] = useState(initial.masterId);
  const [mergedId, setMergedId] = useState(initial.mergedId);
  const [confirming, setConfirming] = useState(false);

  const preview = useApi<MergePreview>(
    () => api.post('/api/customers/merge/preview', { masterId, mergedId }),
    [masterId, mergedId],
  );

  const swap = () => {
    setMasterId(mergedId);
    setMergedId(masterId);
  };

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 12 }}>
        <ArrowLeft size={16} aria-hidden />
        Danh sách nghi trùng
      </button>

      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Giải quyết xung đột khi gộp</h1>
          <p className="small muted">{initial.label}</p>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <span className="label">Chọn khách GIỮ LẠI (master)</span>
        <div className="segmented" role="group" aria-label="Khách giữ lại">
          <button aria-pressed={masterId === initial.masterId} onClick={() => { setMasterId(initial.masterId); setMergedId(initial.mergedId); }}>
            Giữ khách A
          </button>
          <button aria-pressed={masterId === initial.mergedId} onClick={swap}>
            Giữ khách B
          </button>
        </div>
        <span className="caption">Khách còn lại sẽ được gộp vào khách giữ (soft-delete, không xóa nguồn).</span>
      </div>

      {preview.status === 'loading' && <SkeletonCards count={3} />}
      {preview.status === 'error' && <ErrorState error={preview.error} onRetry={preview.reload} />}
      {preview.status === 'success' && (
        <div className="stack-4">
          <PreviewBody preview={preview.data} />

          <div className="row-wrap" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={() => setConfirming(true)}>
              <GitMerge size={16} aria-hidden />
              Gộp khách
            </button>
            <button className="btn btn-outline" onClick={onBack}>
              <X size={16} aria-hidden />
              Không phải trùng
            </button>
          </div>
        </div>
      )}

      {confirming && preview.status === 'success' && (
        <ConfirmMergeModal
          masterId={masterId}
          mergedId={mergedId}
          onClose={() => setConfirming(false)}
          onDone={() => {
            toast('success', 'Đã gộp khách. Dữ liệu nguồn được giữ, hồ sơ bé giữ riêng.');
            onMerged();
          }}
        />
      )}
    </div>
  );
}

function PreviewBody({ preview }: { preview: MergePreview }) {
  return (
    <>
      {/* So sánh từng trường */}
      <section className="card card-pad stack-2">
        <h3 className="h3">So sánh từng trường</h3>
        <div className="list-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Trường</th>
                <th>Khách GIỮ</th>
                <th>Khách gộp</th>
                <th>Kết quả</th>
              </tr>
            </thead>
            <tbody>
              {preview.fields.map((f) => (
                <tr key={f.field}>
                  <td>{FIELD_LABEL[f.field] ?? f.field}</td>
                  <td className="wrap-anywhere">{f.master ?? '—'}</td>
                  <td className="wrap-anywhere">{f.merged ?? '—'}</td>
                  <td>
                    <Badge
                      tone={f.resolution === 'dung_merged' ? 'primary' : 'neutral'}
                      icon={false}
                    >
                      {RESOLUTION_LABEL[f.resolution] ?? f.resolution}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Canonical phone — KHÔNG nhân đôi số */}
      <section className="card card-pad stack-2">
        <div className="between">
          <h3 className="h3">Số điện thoại sau gộp</h3>
          <Badge tone="success" icon={false}>Không nhân đôi số</Badge>
        </div>
        {preview.canonicalPhones.length === 0 ? (
          <p className="small muted">Không có số điện thoại.</p>
        ) : (
          <div className="stack-2">
            {preview.canonicalPhones.map((p) => (
              <div key={p.phoneNormalized} className="kv-field">
                <span className="num">{p.phoneRaw}</span>
                <span className="row" style={{ gap: 6 }}>
                  {p.isPrimary && <Badge tone="primary" icon={false}>Chính</Badge>}
                  {p.sources.length > 0 && <span className="caption">Nguồn: {p.sources.join(', ')}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="caption">
          Số dạng <span className="num">0912…</span> và <span className="num">+84912…</span> được
          nhận là MỘT bản ghi (gộp nhãn nguồn).
        </p>
      </section>

      {/* Consent sau gộp (CONSENT-01) */}
      <section className="card card-pad stack-2">
        <h3 className="h3">Consent sau gộp</h3>
        {preview.consent.length === 0 ? (
          <p className="small muted">Không có sự kiện consent.</p>
        ) : (
          <div className="stack-2">
            {preview.consent.map((c) => (
              <div key={`${c.consentKey}-${c.subjectKey}`} className="between">
                <span>{consentTypeVi[c.consentKey] ?? c.consentKey}</span>
                <Badge tone={c.status === 'granted' ? 'success' : 'neutral'} icon={false}>
                  {consentStatusVi[c.status] ?? c.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
        <p className="caption">
          Sự kiện hợp lệ MỚI NHẤT thắng; nếu không có "đồng ý lại" mới hơn thì trạng thái "đã rút" được
          giữ (không tự suy diễn đồng ý lại).
        </p>
      </section>

      {/* Phần GIỮ */}
      <section className="card card-pad stack-2">
        <h3 className="h3">Dữ liệu được GIỮ</h3>
        <div className="row-wrap" style={{ gap: 8 }}>
          <Badge tone="neutral" icon={false}>{preview.kept.babies} hồ sơ bé (giữ riêng)</Badge>
          <Badge tone="neutral" icon={false}>{preview.kept.consultations} buổi tư vấn</Badge>
          <Badge tone="neutral" icon={false}>{preview.kept.kvCodes} mã KiotViet</Badge>
          <Badge tone="neutral" icon={false}>{preview.kept.phones} số điện thoại</Badge>
          <Badge tone="neutral" icon={false}>{preview.kept.consentEvents} sự kiện consent</Badge>
        </div>
        <div className="notice notice-warning">
          <ShieldAlert size={16} aria-hidden />
          <span className="small">{preview.babyMergeNote}</span>
        </div>
        <p className="small">
          <b>{preview.disclaimer}</b>
        </p>
      </section>
    </>
  );
}

/* 🔴 MERGE-01 / AUTH-12: xác nhận + nhập lại mật khẩu */
function ConfirmMergeModal({
  masterId,
  mergedId,
  onClose,
  onDone,
}: {
  masterId: string;
  mergedId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/customers/merge', { masterId, mergedId, password });
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không gộp được, kiểm tra mật khẩu.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Xác nhận gộp khách"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!password || busy}>
            {busy ? 'Đang gộp…' : 'Xác nhận gộp'}
          </button>
        </>
      }
    >
      <div className="stack-4">
        <div className="notice notice-warning">
          <ShieldAlert size={16} aria-hidden />
          <span className="small">
            KHÔNG XÓA dữ liệu nguồn; mọi xung đột được giải quyết hoặc giữ lịch sử. Hồ sơ bé giữ riêng
            (gắn cờ nghi trùng). Thao tác này có ghi nhật ký.
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="merge-pw">
            Nhập lại mật khẩu để xác minh
          </label>
          <input
            id="merge-pw"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>
      </div>
    </Modal>
  );
}

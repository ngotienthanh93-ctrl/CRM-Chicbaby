import { useState } from 'react';
import { FlaskConical, Pencil, Plus, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import type { ExperimentDTO, ExperimentsResponse, ExperimentStatus } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import { fmtDateTime } from './admin/adminLabels';
import { ReauthModal } from './admin/ReauthModal';
import { ExperimentFormModal } from './experiments/ExperimentFormModal';
import { expStatusTone, expStatusVi, STATUS_TRANSITIONS } from './experiments/experimentLabels';

type ModalState =
  | { kind: 'create' }
  | { kind: 'edit'; exp: ExperimentDTO }
  | { kind: 'status'; exp: ExperimentDTO; next: ExperimentStatus }
  | null;

export function ExperimentsScreen() {
  const toast = useToast();
  const state = useApi<ExperimentsResponse>(() => api.get('/api/experiments'), []);
  const [modal, setModal] = useState<ModalState>(null);

  const closeAndReload = (msg: string) => {
    setModal(null);
    toast('success', msg);
    state.reload();
  };

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Thí nghiệm holdout</h1>
          <p className="small muted">
            Đo tác động thật của nhắc chủ động bằng nhóm giữ lại (holdout). Chưa đủ mẫu ⇒ chưa có kết
            luận. Mọi thao tác yêu cầu nhập lại mật khẩu và được ghi nhật ký.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ kind: 'create' })}>
          <Plus size={16} aria-hidden />
          Tạo thí nghiệm
        </button>
      </div>

      <div className="notice notice-neutral" style={{ marginBottom: 16 }}>
        <ShieldAlert size={16} aria-hidden />
        <span className="small">
          Phân nhóm theo hash(khách + thí nghiệm) — mỗi khách luôn một nhóm suốt thí nghiệm. Việc của
          nhóm holdout KHÔNG hiện ở Việc hôm nay (EXP-04).
        </span>
      </div>

      {state.status === 'loading' && <SkeletonCards count={3} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState
            icon={<FlaskConical size={26} />}
            title="Chưa có thí nghiệm nào"
            hint="Bấm 'Tạo thí nghiệm' để bắt đầu đo tác động bằng nhóm holdout."
          />
        ) : (
          <div className="stack-4">
            {state.data.items.map((exp) => (
              <ExperimentCard
                key={exp.id}
                exp={exp}
                onEdit={() => setModal({ kind: 'edit', exp })}
                onStatus={(next) => setModal({ kind: 'status', exp, next })}
              />
            ))}
          </div>
        ))}

      {modal?.kind === 'create' && (
        <ExperimentFormModal
          mode="create"
          onClose={() => setModal(null)}
          onDone={() => closeAndReload('Đã tạo thí nghiệm (trạng thái Nháp).')}
        />
      )}
      {modal?.kind === 'edit' && (
        <ExperimentFormModal
          mode="edit"
          experiment={modal.exp}
          onClose={() => setModal(null)}
          onDone={() => closeAndReload('Đã cập nhật thí nghiệm.')}
        />
      )}
      {modal?.kind === 'status' && (
        <StatusModal
          exp={modal.exp}
          next={modal.next}
          onClose={() => setModal(null)}
          onDone={() => closeAndReload(`Đã chuyển sang "${expStatusVi[modal.next]}".`)}
        />
      )}
    </div>
  );
}

function ExperimentCard({
  exp,
  onEdit,
  onStatus,
}: {
  exp: ExperimentDTO;
  onEdit: () => void;
  onStatus: (next: ExperimentStatus) => void;
}) {
  const nextStatuses = STATUS_TRANSITIONS[exp.status];
  return (
    <section className="card card-pad stack-2">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <FlaskConical size={18} aria-hidden />
          <h3 className="h3">{exp.name}</h3>
          <Badge tone={expStatusTone[exp.status]}>{expStatusVi[exp.status]}</Badge>
        </div>
        <div className="row-wrap" style={{ gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>
            <Pencil size={14} aria-hidden />
            Sửa
          </button>
          {nextStatuses.map((next) => (
            <button
              key={next}
              className={next === 'completed' ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'}
              onClick={() => onStatus(next)}
            >
              → {expStatusVi[next]}
            </button>
          ))}
        </div>
      </div>

      <div className="info-grid">
        <div className="info-item">
          <span className="label">Bắt đầu</span>
          <span className="value num">{fmtDateTime(exp.startAt)}</span>
        </div>
        <div className="info-item">
          <span className="label">Kết thúc</span>
          <span className="value num">{fmtDateTime(exp.endAt)}</span>
        </div>
        <div className="info-item">
          <span className="label">Tỉ lệ holdout</span>
          <span className="value num">{(exp.holdoutRatio * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Số mẫu + trạng thái đủ mẫu (EXP-06). */}
      <div className="stack-2" style={{ gap: 8 }}>
        <SampleBar
          label="Treatment"
          n={exp.sampleTreatment}
          min={exp.minSampleTreatment}
          enough={exp.enoughTreatment}
        />
        <SampleBar
          label="Holdout"
          n={exp.sampleHoldout}
          min={exp.minSampleHoldout}
          enough={exp.enoughHoldout}
        />
      </div>

      {/* 🔴 EXP-06: chưa đủ mẫu ⇒ KHÔNG hiện kết luận uplift. */}
      {exp.hasConclusion ? (
        <div className="notice notice-neutral">
          <span className="small">
            Đã đủ mẫu cả hai nhóm — xem kết luận tác động (uplift + khoảng tin cậy) ở màn Báo cáo
            (RPT-04).
          </span>
        </div>
      ) : (
        <div className="notice notice-warning">
          <ShieldAlert size={16} aria-hidden />
          <span className="small">
            Chưa đủ mẫu — chưa có kết luận. Cần treatment {exp.sampleTreatment}/{exp.minSampleTreatment}{' '}
            và holdout {exp.sampleHoldout}/{exp.minSampleHoldout}.
          </span>
        </div>
      )}
    </section>
  );
}

/** Thanh tiến độ đủ mẫu cho một nhóm. */
function SampleBar({
  label,
  n,
  min,
  enough,
}: {
  label: string;
  n: number;
  min: number;
  enough: boolean;
}) {
  const pct = min > 0 ? Math.min(100, (n / min) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">
        {label}{' '}
        {enough ? (
          <Badge tone="success" icon={false}>
            đủ mẫu
          </Badge>
        ) : (
          <Badge tone="attention" icon={false}>
            chưa đủ
          </Badge>
        )}
      </span>
      <span className="bar-track">
        <span
          className="bar-fill"
          style={{ width: `${pct}%`, background: enough ? 'var(--c-success)' : 'var(--c-primary)' }}
        />
      </span>
      <span className="bar-value num">
        {n}/{min}
      </span>
    </div>
  );
}

/** 🔴 EXP-05: đổi trạng thái ⇒ nhập lại mật khẩu + audit. */
function StatusModal({
  exp,
  next,
  onClose,
  onDone,
}: {
  exp: ExperimentDTO;
  next: ExperimentStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const isRunning = next === 'running';
  const isCompleted = next === 'completed';
  return (
    <ReauthModal
      title={`Đổi trạng thái: ${exp.name}`}
      submitLabel={`Chuyển sang "${expStatusVi[next]}"`}
      danger={isCompleted}
      warning={
        <div className={`notice ${isRunning || isCompleted ? 'notice-warning' : 'notice-neutral'}`}>
          <ShieldAlert size={16} aria-hidden />
          <span className="small">
            {isRunning &&
              'Bật thí nghiệm sẽ bắt đầu phân nhóm holdout — việc của nhóm holdout sẽ KHÔNG hiện ở Việc hôm nay. '}
            {isCompleted && 'Kết thúc là điểm cuối — không thể chạy lại thí nghiệm này. '}
            Thao tác được ghi nhật ký (EXP-05).
          </span>
        </div>
      }
      onClose={onClose}
      onSubmit={(password) => api.post(`/api/experiments/${exp.id}/status`, { status: next, password })}
      onDone={onDone}
    />
  );
}

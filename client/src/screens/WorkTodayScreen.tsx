import { useState } from 'react';
import {
  Phone,
  HandMetal,
  MoreHorizontal,
  Lock,
  Clock,
  ShoppingBag,
  History,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../api/client';
import type { WorkCard, WorkTodayResponse } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import { WorkActionSheet } from './work/WorkActionSheet';
import { ConsultationModal } from './consultation/ConsultationModal';
import { reminderTypeVi, workBadgeTone } from '../lib/labels';

export function WorkTodayScreen() {
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const state = useApi<WorkTodayResponse>(
    () => api.get<WorkTodayResponse>(`/api/work/today?scope=${scope}`),
    [scope],
  );
  const [active, setActive] = useState<WorkCard | null>(null);
  // §11.2: mở nhanh ghi chú tư vấn từ SCR-02 cho việc target=customer.
  const [consultFor, setConsultFor] = useState<string | null>(null);

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Việc hôm nay</h1>
          <p className="small muted">Hôm nay tôi gọi ai, nói gì — gộp cả nhắc tái mua và đại lý.</p>
        </div>
        <div className="segmented" role="group" aria-label="Phạm vi việc">
          <button aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
            Việc của tôi
          </button>
          <button aria-pressed={scope === 'team'} onClick={() => setScope('team')}>
            Toàn đội
          </button>
        </div>
      </div>

      {state.status === 'success' && (
        <KpiBar kpi={state.data.kpi} updatedAt={state.data.updatedAt} />
      )}

      <div style={{ marginTop: 16 }}>
        {state.status === 'loading' && <SkeletonCards count={5} />}
        {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
        {state.status === 'success' &&
          (state.data.items.length === 0 ? (
            <EmptyState
              title="Không có việc nào cần gọi hôm nay"
              hint="Chuyển sang 'Toàn đội' để xem việc của cả nhóm, hoặc quay lại sau."
            />
          ) : (
            <div className="stack">
              {state.data.items.map((card) => (
                <WorkCardView key={card.id} card={card} onProcess={() => setActive(card)} />
              ))}
            </div>
          ))}
      </div>

      {active && (
        <WorkActionSheet
          card={active}
          onClose={() => setActive(null)}
          onDone={() => {
            setActive(null);
            state.reload();
          }}
          onOpenConsultation={
            active.customerId
              ? () => {
                  setConsultFor(active.customerId);
                  setActive(null);
                }
              : undefined
          }
        />
      )}

      {consultFor && (
        <ConsultationModal
          customerId={consultFor}
          onClose={() => setConsultFor(null)}
          onSaved={() => {
            setConsultFor(null);
            state.reload();
          }}
        />
      )}
    </div>
  );
}

function KpiBar({
  kpi,
  updatedAt,
}: {
  kpi: WorkTodayResponse['kpi'];
  updatedAt: string;
}) {
  return (
    <div className="stack-2">
      <div className="kpi-bar">
        <div className="card kpi kpi-danger">
          <span className="kpi-icon" aria-hidden>
            <AlertCircle size={20} />
          </span>
          <span className="kpi-value num">{kpi.atRisk}</span>
          <span className="kpi-label">Nguy cơ mất</span>
        </div>
        <div className="card kpi kpi-warning">
          <span className="kpi-icon" aria-hidden>
            <Clock size={20} />
          </span>
          <span className="kpi-value num">{kpi.overdue}</span>
          <span className="kpi-label">Quá hạn</span>
        </div>
        <div className="card kpi kpi-primary">
          <span className="kpi-icon" aria-hidden>
            <Phone size={20} />
          </span>
          <span className="kpi-value num">{kpi.needCall}</span>
          <span className="kpi-label">Cần gọi</span>
        </div>
        <div className="card kpi kpi-success">
          <span className="kpi-icon" aria-hidden>
            <CheckCircle2 size={20} />
          </span>
          <span className="kpi-value num">{kpi.doneToday}</span>
          <span className="kpi-label">Đã xong hôm nay</span>
        </div>
      </div>
      <p className="caption">
        Cập nhật {updatedAt} · số liệu đã loại nhóm đối chứng (holdout).
      </p>
    </div>
  );
}

function WorkCardView({ card, onProcess }: { card: WorkCard; onProcess: () => void }) {
  const { permissions, user } = useAuth();
  const toast = useToast();
  const canClaim = permissions?.role !== 'marketing';
  // Chỉ báo "người khác đang xử lý" khi KHÔNG phải chính mình giữ việc.
  const lockedByOther =
    card.claim.state === 'in_progress' && !!card.claim.by && card.claim.by !== user?.id;

  // Số thật (không chứa ký tự mask) mới bấm gọi được.
  const callablePhone = card.phone && !card.phone.includes('…') ? card.phone : null;

  const claim = async () => {
    try {
      await api.post(`/api/followups/${card.id}/claim`);
      toast('success', 'Đã nhận việc. Bắt đầu gọi nhé!');
    } catch {
      toast('error', 'Việc này đang được người khác xử lý.');
    }
  };

  return (
    <article className={`card work-card lvl-${card.badge.level}`}>
      <div className="work-card-top">
        <div className="stack-2" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={workBadgeTone[card.badge.level] ?? 'neutral'}>{card.badge.label}</Badge>
            {card.overdue && <Badge tone="warning">Quá hạn</Badge>}
            {card.targetType === 'organization' && card.badge.level === 'at_risk' && (
              <Badge tone="danger" icon={false}>
                Chủ shop xử lý
              </Badge>
            )}
          </div>
          <div className="work-name">{card.targetName}</div>
          <div className="caption">{reminderTypeVi[card.reminderType] ?? card.reminderType}</div>
        </div>
        <div className="stack-2" style={{ alignItems: 'flex-end', gap: 4 }}>
          {card.phone && (
            <span className="phone-chip">
              <Phone size={14} aria-hidden />
              {card.phone}
            </span>
          )}
          {card.phoneOf && <span className="caption">{card.phoneOf}</span>}
        </div>
      </div>

      {card.content && <div className="work-content">{card.content}</div>}

      <div className="work-meta">
        <span>
          <Clock size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Đến hạn: <b>{card.dueDate}</b>
        </span>
        {card.lastPurchaseAt && (
          <span>
            <History size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Mua gần nhất: <b>{card.lastPurchaseAt}</b>
          </span>
        )}
        {card.babies.length > 0 && (
          <span>
            <ShoppingBag size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Bé:{' '}
            <b>
              {card.babies
                .map((b) => `${b.babyName ?? 'Bé'} (${b.ageMonths ?? '?'} tháng)`)
                .join(', ')}
            </b>
          </span>
        )}
      </div>

      {lockedByOther && (
        <span className="claim-note">
          <Lock size={13} aria-hidden />
          Đang có người xử lý (từ {card.claim.since ?? 'gần đây'})
        </span>
      )}

      <div className="work-actions">
        {callablePhone ? (
          <a className="btn btn-primary" href={`tel:${callablePhone}`}>
            <Phone size={16} aria-hidden />
            Gọi
          </a>
        ) : (
          <button className="btn btn-primary" disabled title="Cần quyền xem số điện thoại">
            <Phone size={16} aria-hidden />
            Gọi
          </button>
        )}
        {canClaim && !lockedByOther && card.claim.state !== 'in_progress' && (
          <button className="btn btn-outline" onClick={claim}>
            <HandMetal size={16} aria-hidden />
            Nhận việc
          </button>
        )}
        {canClaim && (
          <button
            className="btn btn-outline"
            onClick={onProcess}
            disabled={lockedByOther}
            title={lockedByOther ? 'Người khác đang xử lý việc này' : undefined}
          >
            <MoreHorizontal size={16} aria-hidden />
            Ghi kết quả
          </button>
        )}
      </div>
    </article>
  );
}

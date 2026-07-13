import { useState } from 'react';
import {
  CheckCircle2,
  CalendarClock,
  PhoneOff,
  XCircle,
  UserPlus,
  ShoppingCart,
  ChevronLeft,
  Baby as BabyIcon,
  Pause,
  PackageX,
  MessageSquarePlus,
} from 'lucide-react';
import { api } from '../../api/client';
import type { UserRef, WorkCard } from '../../api/types';
import { useAuth } from '../../app/AuthContext';
import { BottomSheet } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { closeReasonVi, roleVi } from '../../lib/labels';

type View = 'menu' | 'result' | 'snooze' | 'close' | 'reassign' | 'confirmBaby' | 'pause' | 'stockout';

export function WorkActionSheet({
  card,
  onClose,
  onDone,
  onOpenConsultation,
}: {
  card: WorkCard;
  onClose: () => void;
  onDone: () => void;
  /** Mở nhanh modal ghi chú tư vấn (§11.2 CON-07) — do màn cha xử lý (đóng sheet + mở modal). */
  onOpenConsultation?: () => void;
}) {
  const toast = useToast();
  const { permissions } = useAuth();
  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);

  const isCustomer = card.targetType === 'customer';
  const isOrg = card.targetType === 'organization';
  const canConfirmBaby = isCustomer && card.confirmableBabies.length > 0 && !!permissions?.manageBaby;
  const canConsult = isCustomer && !!permissions?.viewConsultation && !!permissions?.manageBaby;
  const canManageOrg = isOrg && !!permissions?.manageOrganization && !!card.organizationId;

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', okMsg);
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thực hiện được, thử lại.');
      setBusy(false);
    }
  };

  const back = () => setView('menu');

  return (
    <BottomSheet
      title={view === 'menu' ? `Xử lý: ${card.targetName}` : subTitle(view)}
      onClose={onClose}
    >
      {view !== 'menu' && (
        <button className="btn btn-ghost btn-sm" onClick={back} style={{ marginBottom: 8 }}>
          <ChevronLeft size={16} aria-hidden />
          Quay lại
        </button>
      )}

      {view === 'menu' && (
        <div className="stack-2">
          <SheetBtn icon={<CheckCircle2 size={18} />} onClick={() => setView('result')}>
            Ghi kết quả cuộc gọi
          </SheetBtn>
          <SheetBtn icon={<ShoppingCart size={18} />} onClick={() =>
            run(() => api.post(`/api/followups/${card.id}/mark-purchased`), 'Đã đánh dấu mua lại.')
          } disabled={busy}>
            Đánh dấu đã mua lại
          </SheetBtn>
          {/* §11.1: Xác nhận bé (suggested -> confirmed) khi việc target=customer có danh sách bé. */}
          {canConfirmBaby && (
            <SheetBtn icon={<BabyIcon size={18} />} onClick={() => setView('confirmBaby')}>
              Xác nhận bé cho việc này
            </SheetBtn>
          )}
          {/* §11.2: mở nhanh ghi chú tư vấn (CON-07). */}
          {canConsult && onOpenConsultation && (
            <SheetBtn icon={<MessageSquarePlus size={18} />} onClick={onOpenConsultation}>
              Ghi chú tư vấn
            </SheetBtn>
          )}
          {/* §11.1: đại lý at_risk — tạm dừng cảnh báo NHẬP (paused / shop hết hàng). */}
          {canManageOrg && (
            <>
              <SheetBtn icon={<Pause size={18} />} onClick={() => setView('pause')}>
                Tạm dừng cảnh báo (đại lý)
              </SheetBtn>
              <SheetBtn icon={<PackageX size={18} />} onClick={() => setView('stockout')}>
                Báo shop hết hàng
              </SheetBtn>
            </>
          )}
          <SheetBtn icon={<CalendarClock size={18} />} onClick={() => setView('snooze')}>
            Dời nhắc (+7 / +14 / +30)
          </SheetBtn>
          <SheetBtn icon={<UserPlus size={18} />} onClick={() => setView('reassign')}>
            Chuyển người phụ trách
          </SheetBtn>
          <SheetBtn icon={<XCircle size={18} />} danger onClick={() => setView('close')}>
            Đóng việc (chọn lý do)
          </SheetBtn>
        </div>
      )}

      {view === 'confirmBaby' && (
        <div className="stack-2">
          <p className="small muted">
            Chọn bé để nâng nhắc từ mức "gợi ý" lên "đã xác nhận". Chỉ chọn khi chắc chắn — hồ sơ bé sai
            tệ hơn hồ sơ trống.
          </p>
          {card.confirmableBabies.map((b) => (
            <SheetBtn
              key={b.id}
              icon={<BabyIcon size={18} />}
              disabled={busy}
              onClick={() =>
                run(
                  () => api.post(`/api/followups/${card.id}/confirm-baby`, { babyId: b.id }),
                  `Đã xác nhận bé ${b.displayName}.`,
                )
              }
            >
              {b.displayName}
            </SheetBtn>
          ))}
        </div>
      )}

      {view === 'pause' && card.organizationId && (
        <PauseView orgId={card.organizationId} busy={busy} run={run} />
      )}
      {view === 'stockout' && card.organizationId && (
        <StockoutView orgId={card.organizationId} busy={busy} run={run} />
      )}

      {view === 'result' && (
        <div className="stack-2">
          <p className="small muted">Tách rõ khách đã mua thật với khách chỉ mới có ý định.</p>
          <SheetBtn
            icon={<CheckCircle2 size={18} />}
            onClick={() =>
              run(
                () => api.post(`/api/followups/${card.id}/result`, { outcome: 'already_purchased' }),
                'Đã ghi: khách báo ĐÃ MUA (chờ đối soát hóa đơn).',
              )
            }
            disabled={busy}
          >
            Khách nói ĐÃ MUA rồi
          </SheetBtn>
          <SheetBtn
            icon={<CalendarClock size={18} />}
            onClick={() =>
              run(
                () => api.post(`/api/followups/${card.id}/result`, { outcome: 'intends_to_purchase' }),
                'Đã ghi: khách SẼ MUA — hẹn kiểm tra lại.',
              )
            }
            disabled={busy}
          >
            Khách nói SẼ MUA (chưa mua)
          </SheetBtn>
          <SheetBtn
            icon={<PhoneOff size={18} />}
            onClick={() =>
              run(
                () => api.post(`/api/followups/${card.id}/result`, { outcome: 'no_answer' }),
                'Đã ghi: không nghe máy (việc vẫn mở).',
              )
            }
            disabled={busy}
          >
            Không nghe máy
          </SheetBtn>
        </div>
      )}

      {view === 'snooze' && (
        <div className="stack-2">
          {[7, 14, 30].map((d) => (
            <SheetBtn
              key={d}
              icon={<CalendarClock size={18} />}
              onClick={() =>
                run(
                  () => api.post(`/api/followups/${card.id}/snooze`, { days: d }),
                  `Đã dời nhắc thêm ${d} ngày.`,
                )
              }
              disabled={busy}
            >
              Dời thêm {d} ngày
            </SheetBtn>
          ))}
        </div>
      )}

      {view === 'close' && <CloseView cardId={card.id} busy={busy} run={run} />}

      {view === 'reassign' && <ReassignView cardId={card.id} busy={busy} run={run} />}
    </BottomSheet>
  );
}

function subTitle(v: View): string {
  switch (v) {
    case 'result':
      return 'Ghi kết quả cuộc gọi';
    case 'snooze':
      return 'Dời nhắc';
    case 'close':
      return 'Đóng việc';
    case 'reassign':
      return 'Chuyển người phụ trách';
    case 'confirmBaby':
      return 'Xác nhận bé';
    case 'pause':
      return 'Tạm dừng cảnh báo';
    case 'stockout':
      return 'Báo shop hết hàng';
    default:
      return 'Xử lý';
  }
}

function SheetBtn({
  icon,
  children,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`btn ${danger ? 'btn-danger' : 'btn-outline'} btn-block`}
      style={{ justifyContent: 'flex-start', minHeight: 48 }}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {children}
    </button>
  );
}

function CloseView({
  cardId,
  busy,
  run,
}: {
  cardId: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>, okMsg: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="stack-2">
      <p className="small muted">Đóng việc bắt buộc chọn lý do.</p>
      <div className="field">
        <label className="label" htmlFor="close-reason">
          Lý do đóng
        </label>
        <select
          id="close-reason"
          className="select"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">— Chọn lý do —</option>
          {Object.entries(closeReasonVi).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <button
        className="btn btn-danger btn-block"
        disabled={!reason || busy}
        onClick={() =>
          run(
            () => api.post(`/api/followups/${cardId}/close`, { closeReason: reason }),
            'Đã đóng việc.',
          )
        }
      >
        <XCircle size={18} aria-hidden />
        Xác nhận đóng
      </button>
    </div>
  );
}

function PauseView({
  orgId,
  busy,
  run,
}: {
  orgId: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>, okMsg: string) => void;
}) {
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="stack-4">
      <p className="small muted">
        Chỉ dừng cảnh báo NHẬP (nghỉ Tết, tạm ngừng nhập). Công nợ / khiếu nại vẫn theo dõi.
      </p>
      <div className="field">
        <label className="label" htmlFor="ws-pause-until">Tạm nghỉ đến ngày</label>
        <input id="ws-pause-until" className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="ws-pause-reason">Lý do</label>
        <input id="ws-pause-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nghỉ Tết…" />
      </div>
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={() =>
          run(
            () =>
              api.post(`/api/organizations/${orgId}/pause`, {
                pausedUntil: until ? new Date(until).toISOString() : undefined,
                reason: reason || undefined,
              }),
            'Đã tạm dừng cảnh báo nhập.',
          )
        }
      >
        <Pause size={18} aria-hidden />
        Xác nhận tạm dừng
      </button>
    </div>
  );
}

function StockoutView({
  orgId,
  busy,
  run,
}: {
  orgId: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>, okMsg: string) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const valid = from && to;
  return (
    <div className="stack-4">
      <p className="small muted">Khoảng thời gian shop hết hàng — để loại trừ cảnh báo nguy cơ sai.</p>
      <div className="field">
        <label className="label" htmlFor="ws-so-from">Từ ngày</label>
        <input id="ws-so-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="field">
        <label className="label" htmlFor="ws-so-to">Đến ngày</label>
        <input id="ws-so-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <button
        className="btn btn-primary btn-block"
        disabled={!valid || busy}
        onClick={() =>
          run(
            () =>
              api.post(`/api/organizations/${orgId}/stockout`, {
                fromDate: new Date(from).toISOString(),
                toDate: new Date(to).toISOString(),
              }),
            'Đã ghi nhận shop hết hàng.',
          )
        }
      >
        <PackageX size={18} aria-hidden />
        Xác nhận
      </button>
    </div>
  );
}

function ReassignView({
  cardId,
  busy,
  run,
}: {
  cardId: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>, okMsg: string) => void;
}) {
  const [users, setUsers] = useState<UserRef[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  if (users === null && !loadErr) {
    api
      .get<{ items: UserRef[] }>('/api/users')
      .then((r) => setUsers(r.items))
      .catch(() => setLoadErr(true));
    return <p className="small muted">Đang tải danh sách nhân viên…</p>;
  }
  if (loadErr) return <p className="small muted">Không tải được danh sách nhân viên.</p>;
  return (
    <div className="stack-2">
      {users!.map((u) => (
        <SheetBtn
          key={u.id}
          icon={<UserPlus size={18} />}
          onClick={() =>
            run(
              () => api.post(`/api/followups/${cardId}/reassign`, { assigneeId: u.id }),
              `Đã chuyển việc cho ${u.fullName}.`,
            )
          }
          disabled={busy}
        >
          {u.fullName} · {roleVi[u.role] ?? u.role}
        </SheetBtn>
      ))}
    </div>
  );
}

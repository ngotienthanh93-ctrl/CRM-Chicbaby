import { useCallback, useEffect, useState } from 'react';
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
  Image as ImageIcon,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import type { FollowUpEvidence, UserRef, WorkCard } from '../../api/types';
import { useAuth } from '../../app/AuthContext';
import { BottomSheet } from '../../components/Modal';
import { EvidenceGallery } from '../../components/EvidenceGallery';
import { useToast } from '../../components/Toast';
import { closeReasonVi, roleVi } from '../../lib/labels';
import { compressImage } from '../../lib/image';

type View =
  | 'menu'
  | 'result'
  | 'markPurchased'
  | 'snooze'
  | 'close'
  | 'reassign'
  | 'confirmBaby'
  | 'pause'
  | 'stockout'
  | 'evidence';

/** Số ảnh bằng chứng tối đa đính kèm 1 lần ghi kết quả. */
const MAX_EVIDENCE_IMAGES = 3;

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
  // Ảnh bằng chứng đang chọn (data URL đã nén) cho lần ghi kết quả hiện tại.
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  // Danh sách ảnh bằng chứng đã lưu (để xem lại + hiện số lượng ở menu).
  const [evidence, setEvidence] = useState<FollowUpEvidence[] | null>(null);

  const isCustomer = card.targetType === 'customer';
  const isOrg = card.targetType === 'organization';
  const canConfirmBaby = isCustomer && card.confirmableBabies.length > 0 && !!permissions?.manageBaby;
  const canConsult = isCustomer && !!permissions?.viewConsultation && !!permissions?.manageBaby;
  const canManageOrg = isOrg && !!permissions?.manageOrganization && !!card.organizationId;
  const canProcess = !!permissions?.processWork;
  const isOwner = permissions?.role === 'chu_shop';
  // Có bằng chứng để ghi "ĐÃ MUA"/"SẼ MUA" khi: đang chọn ảnh mới HOẶC việc đã có ảnh lưu trước đó.
  // (Server đếm count > 0 từ mọi nguồn; UI không khóa oan việc đã đính ảnh từ phiên khác.)
  const hasEvidence = pendingImages.length > 0 || (evidence?.length ?? 0) > 0;

  const reloadEvidence = useCallback(
    () =>
      api
        .get<{ items: FollowUpEvidence[] }>(`/api/followups/${card.id}/attachments`)
        .then((r) => setEvidence(r.items))
        .catch(() => setEvidence([])),
    [card.id],
  );
  // Tải trước danh sách ảnh để hiện số lượng ở menu (chỉ vai xử lý việc; router gate processWork).
  useEffect(() => {
    if (canProcess) void reloadEvidence();
  }, [canProcess, reloadEvidence]);

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

  // Chọn ảnh: nén phía client rồi thêm vào danh sách chờ (tối đa MAX_EVIDENCE_IMAGES).
  const onPickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const room = MAX_EVIDENCE_IMAGES - pendingImages.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    e.target.value = ''; // cho phép chọn lại cùng tệp
    if (picked.length === 0) return;
    setCompressing(true);
    try {
      const dataUrls = await Promise.all(picked.map((f) => compressImage(f)));
      setPendingImages((prev) => [...prev, ...dataUrls].slice(0, MAX_EVIDENCE_IMAGES));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không xử lý được ảnh.');
    } finally {
      setCompressing(false);
    }
  };

  // Upload lần lượt ảnh bằng chứng đang chọn (dùng chung cho ghi kết quả & đánh dấu đã mua).
  const uploadPendingImages = async () => {
    for (const image of pendingImages) {
      await api.post(`/api/followups/${card.id}/attachments`, { image });
    }
  };

  // Ghi kết quả: upload ảnh bằng chứng TRƯỚC; nếu upload lỗi thì KHÔNG gọi result.
  const submitResult = async (outcome: string, okMsg: string) => {
    setBusy(true);
    try {
      await uploadPendingImages();
      await api.post(`/api/followups/${card.id}/result`, { outcome });
      toast('success', okMsg);
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thực hiện được, thử lại.');
      setBusy(false);
    }
  };

  // Đánh dấu đã mua lại: cũng bắt buộc qua bước ảnh; upload TRƯỚC, lỗi upload thì KHÔNG mark-purchased.
  const submitMarkPurchased = async () => {
    setBusy(true);
    try {
      await uploadPendingImages();
      await api.post(`/api/followups/${card.id}/mark-purchased`);
      toast('success', 'Đã đánh dấu mua lại.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thực hiện được, thử lại.');
      setBusy(false);
    }
  };

  // Đóng việc: bắt buộc ảnh bằng chứng cho MỌI lý do; upload TRƯỚC, lỗi upload thì KHÔNG đóng.
  const submitClose = async (reason: string) => {
    setBusy(true);
    try {
      await uploadPendingImages();
      await api.post(`/api/followups/${card.id}/close`, { closeReason: reason });
      toast('success', 'Đã đóng việc.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không thực hiện được, thử lại.');
      setBusy(false);
    }
  };

  // Xóa ảnh bằng chứng (chỉ chu_shop — server enforce; UI cũng ẩn nút với vai khác).
  const deleteEvidence = async (attId: string) => {
    setBusy(true);
    try {
      await api.del(`/api/followups/${card.id}/attachments/${attId}`);
      await reloadEvidence();
      toast('success', 'Đã xóa ảnh bằng chứng.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không xóa được ảnh, thử lại.');
    } finally {
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
          {canProcess && (
            <SheetBtn icon={<ImageIcon size={18} />} onClick={() => setView('evidence')}>
              Ảnh bằng chứng ({evidence?.length ?? 0})
            </SheetBtn>
          )}
          <SheetBtn icon={<ShoppingCart size={18} />} onClick={() => setView('markPurchased')} disabled={busy}>
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

          {/* Khu đính kèm ảnh bằng chứng (ảnh chụp màn hình chat Zalo/FB). */}
          <EvidencePicker
            images={pendingImages}
            compressing={compressing}
            busy={busy}
            onPick={onPickImages}
            onRemove={(i) => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
          />
          {!hasEvidence && (
            <p className="small muted">Bắt buộc đính kèm ảnh bằng chứng để ghi "ĐÃ MUA" / "SẼ MUA".</p>
          )}

          <SheetBtn
            icon={<CheckCircle2 size={18} />}
            onClick={() =>
              submitResult('already_purchased', 'Đã ghi: khách báo ĐÃ MUA (chờ đối soát hóa đơn).')
            }
            disabled={busy || compressing || !hasEvidence}
          >
            Khách nói ĐÃ MUA rồi
          </SheetBtn>
          <SheetBtn
            icon={<CalendarClock size={18} />}
            onClick={() =>
              submitResult('intends_to_purchase', 'Đã ghi: khách SẼ MUA — hẹn kiểm tra lại.')
            }
            disabled={busy || compressing || !hasEvidence}
          >
            Khách nói SẼ MUA (chưa mua)
          </SheetBtn>
          <SheetBtn
            icon={<PhoneOff size={18} />}
            onClick={() => submitResult('no_answer', 'Đã ghi: không nghe máy (việc vẫn mở).')}
            disabled={busy || compressing}
          >
            Không nghe máy
          </SheetBtn>
        </div>
      )}

      {view === 'markPurchased' && (
        <div className="stack-2">
          <p className="small muted">
            Đánh dấu đã mua lại sẽ đối soát với hóa đơn KiotViet. Bắt buộc đính kèm ảnh bằng chứng liên hệ.
          </p>

          {/* Dùng chung cơ chế chọn/nén/preview ảnh của bước ghi kết quả. */}
          <EvidencePicker
            images={pendingImages}
            compressing={compressing}
            busy={busy}
            onPick={onPickImages}
            onRemove={(i) => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
          />
          {!hasEvidence && (
            <p className="small muted">Bắt buộc đính kèm ảnh bằng chứng để đánh dấu đã mua lại.</p>
          )}

          <SheetBtn
            icon={<ShoppingCart size={18} />}
            onClick={submitMarkPurchased}
            disabled={busy || compressing || !hasEvidence}
          >
            Xác nhận đã mua lại
          </SheetBtn>
        </div>
      )}

      {view === 'evidence' && (
        <EvidenceGallery
          items={evidence}
          canDelete={isOwner}
          busy={busy}
          onDelete={deleteEvidence}
        />
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

      {view === 'close' && (
        <CloseView
          images={pendingImages}
          compressing={compressing}
          busy={busy}
          onPick={onPickImages}
          onRemove={(i) => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
          hasEvidence={hasEvidence}
          onSubmit={submitClose}
        />
      )}

      {view === 'reassign' && <ReassignView cardId={card.id} busy={busy} run={run} />}
    </BottomSheet>
  );
}

function subTitle(v: View): string {
  switch (v) {
    case 'result':
      return 'Ghi kết quả cuộc gọi';
    case 'markPurchased':
      return 'Đánh dấu đã mua lại';
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
    case 'evidence':
      return 'Ảnh bằng chứng';
    default:
      return 'Xử lý';
  }
}

/** Khu chọn + xem trước ảnh bằng chứng đang chờ gửi. */
function EvidencePicker({
  images,
  compressing,
  busy,
  onPick,
  onRemove,
}: {
  images: string[];
  compressing: boolean;
  busy: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
}) {
  const full = images.length >= MAX_EVIDENCE_IMAGES;
  const disabled = full || busy || compressing;
  return (
    <div className="stack-2">
      {images.length > 0 && (
        <div className="row-wrap" style={{ gap: 8 }}>
          {images.map((src, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={src}
                alt={`Ảnh bằng chứng ${i + 1}`}
                style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, display: 'block' }}
              />
              <button
                type="button"
                className="btn btn-danger btn-icon btn-sm"
                aria-label="Gỡ ảnh"
                onClick={() => onRemove(i)}
                disabled={busy}
                style={{ position: 'absolute', top: -8, right: -8, minHeight: 'auto', padding: 4 }}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      <label
        className="btn btn-outline btn-block"
        style={{
          minHeight: 48,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <ImageIcon size={18} aria-hidden />
        {compressing
          ? 'Đang xử lý ảnh…'
          : full
            ? `Tối đa ${MAX_EVIDENCE_IMAGES} ảnh`
            : 'Đính kèm ảnh bằng chứng'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={onPick}
          disabled={disabled}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  );
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
  images,
  compressing,
  busy,
  onPick,
  onRemove,
  hasEvidence,
  onSubmit,
}: {
  images: string[];
  compressing: boolean;
  busy: boolean;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  hasEvidence: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="stack-2">
      <p className="small muted">Đóng việc bắt buộc chọn lý do và đính kèm ảnh bằng chứng.</p>
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

      {/* Bắt buộc ảnh bằng chứng cho MỌI lý do đóng — kể cả "không phản hồi" vẫn phải có ảnh thực hiện cuộc gọi. */}
      <EvidencePicker
        images={images}
        compressing={compressing}
        busy={busy}
        onPick={onPick}
        onRemove={onRemove}
      />
      {!hasEvidence && (
        <p className="small muted">
          Bắt buộc đính kèm ảnh bằng chứng đã trao đổi/thực hiện cuộc gọi để đóng việc.
        </p>
      )}

      <button
        className="btn btn-danger btn-block"
        disabled={!reason || busy || compressing || !hasEvidence}
        onClick={() => onSubmit(reason)}
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

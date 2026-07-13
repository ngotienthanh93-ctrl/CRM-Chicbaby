import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, SkipForward, Split, Baby as BabyIcon, Layers, Keyboard, Info } from 'lucide-react';
import { api } from '../api/client';
import type { AllocationGroup, AllocationLine, AllocationsResponse, Baby, BulkPreviewResponse } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import { assignmentStatusVi, assignmentStatusTone, confidenceVi } from '../lib/labels';

type TabKey = 'needs' | 'auto' | 'done';
const TAB_LABEL: Record<TabKey, string> = {
  needs: 'Cần xử lý',
  auto: 'Đã tự gắn (kiểm tra)',
  done: 'Đã xong',
};

interface FlatLine {
  group: AllocationGroup;
  line: AllocationLine;
}

export function AllocationScreen() {
  const [tab, setTab] = useState<TabKey>('needs');
  const state = useApi<AllocationsResponse>(
    () => api.get<AllocationsResponse>(`/api/allocations?status=${tab}`),
    [tab],
  );

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Phân bổ hóa đơn cho bé</h1>
          <p className="small muted">
            Gắn đúng sản phẩm cho đúng bé. Mục tiêu: xử lý nhanh bằng bàn phím.
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        {(Object.keys(TAB_LABEL) as TabKey[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className="tab"
            onClick={() => setTab(k)}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      {state.status === 'loading' && <SkeletonCards count={4} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.groups.length === 0 ? (
          <EmptyState
            icon={<BabyIcon size={26} />}
            title={tab === 'needs' ? 'Không còn dòng nào cần xử lý' : 'Chưa có dữ liệu ở mục này'}
            hint={
              tab === 'needs'
                ? 'Tuyệt vời! Mọi hóa đơn gợi ý đã được xử lý.'
                : 'Các dòng sẽ xuất hiện khi có phân bổ tương ứng.'
            }
          />
        ) : (
          <AllocationBoard tab={tab} groups={state.data.groups} onChanged={state.reload} />
        ))}
    </div>
  );
}

function AllocationBoard({
  tab,
  groups,
  onChanged,
}: {
  tab: TabKey;
  groups: AllocationGroup[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const editable = tab === 'needs';
  const flat: FlatLine[] = useMemo(
    () => groups.flatMap((g) => g.lines.map((line) => ({ group: g, line }))),
    [groups],
  );

  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedBaby, setSelectedBaby] = useState<Record<string, string>>({});
  const [babyCache, setBabyCache] = useState<Record<string, Baby[]>>({});
  const [splitLine, setSplitLine] = useState<AllocationLine | null>(null);
  const [pickerLine, setPickerLine] = useState<{ line: AllocationLine; customerId: string | null } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<BulkPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const active = flat[activeIdx];

  // Nạp danh sách bé của khách đang active (để chọn bé bằng ↑/↓ hoặc modal).
  const loadBabies = useCallback(
    async (customerId: string | null) => {
      if (!customerId || babyCache[customerId]) return;
      try {
        const res = await api.get<{ items: Baby[] }>(`/api/customers/${customerId}/babies`);
        setBabyCache((prev) => ({ ...prev, [customerId]: res.items }));
      } catch {
        setBabyCache((prev) => ({ ...prev, [customerId]: [] }));
      }
    },
    [babyCache],
  );

  useEffect(() => {
    if (editable && active?.group.customerId) void loadBabies(active.group.customerId);
  }, [editable, active, loadBabies]);

  const currentBabyId = (line: AllocationLine): string | undefined =>
    selectedBaby[line.allocationId] ?? line.suggestedBaby?.id ?? undefined;

  const confirmLine = useCallback(
    async (line: AllocationLine) => {
      const babyId = currentBabyId(line);
      if (!babyId) {
        toast('error', 'Chưa có bé để xác nhận. Chọn bé hoặc chuyển cấp khách.');
        return;
      }
      setBusy(true);
      try {
        await api.post(`/api/allocations/${line.allocationId}/confirm`, { babyId });
        toast('success', 'Đã xác nhận bé cho dòng hàng.');
        onChanged();
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Không xác nhận được.');
      } finally {
        setBusy(false);
      }
    },
    // selectedBaby thay đổi cũng cần bản mới -> để deps rỗng, đọc qua closure hiện tại
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChanged, toast, selectedBaby],
  );

  const skipLine = useCallback(
    async (line: AllocationLine) => {
      setBusy(true);
      try {
        const res = await api.post<{ warnAvoidance: boolean }>(
          `/api/allocations/${line.allocationId}/skip`,
        );
        toast(res.warnAvoidance ? 'error' : 'success', res.warnAvoidance
          ? 'Đã chuyển cấp khách — dòng này đã bị bỏ qua nhiều lần.'
          : 'Đã chuyển sang cấp khách.');
        onChanged();
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Không thực hiện được.');
      } finally {
        setBusy(false);
      }
    },
    [onChanged, toast],
  );

  const cycleBaby = useCallback(
    (line: AllocationLine, customerId: string | null, dir: 1 | -1) => {
      const babies = customerId ? babyCache[customerId] ?? [] : [];
      if (babies.length === 0) return;
      const cur = currentBabyId(line);
      const idx = babies.findIndex((b) => b.id === cur);
      const next = babies[(idx + dir + babies.length) % babies.length];
      setSelectedBaby((prev) => ({ ...prev, [line.allocationId]: next.id }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [babyCache, selectedBaby],
  );

  // ---- Phím tắt (§8.6) ----
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      // Bỏ qua khi đang gõ trong input/modal.
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (splitLine || pickerLine || preview) return;
      if (!active) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          cycleBaby(active.line, active.group.customerId, 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          cycleBaby(active.line, active.group.customerId, -1);
          break;
        case 'Enter':
          e.preventDefault();
          void confirmLine(active.line);
          break;
        case 'Tab':
          e.preventDefault();
          setActiveIdx((i) => (e.shiftKey ? Math.max(i - 1, 0) : Math.min(i + 1, flat.length - 1)));
          break;
        case 's':
        case 'S':
          e.preventDefault();
          void skipLine(active.line);
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          setSplitLine(active.line);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, active, flat.length, splitLine, pickerLine, preview, confirmLine, skipLine, cycleBaby]);

  const runBulkPreview = async () => {
    if (checked.size === 0) return;
    setBusy(true);
    try {
      const res = await api.post<BulkPreviewResponse>('/api/allocations/bulk-preview', {
        allocationIds: [...checked],
      });
      setPreview(res);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không tạo được xem trước.');
    } finally {
      setBusy(false);
    }
  };

  const applyBulk = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ applied: number; rejected: unknown[] }>(
        '/api/allocations/bulk-apply',
        { allocationIds: [...checked] },
      );
      toast('success', `Đã áp ${res.applied} dòng. Bỏ qua ${res.rejected.length} dòng không đủ điều kiện.`);
      setPreview(null);
      setChecked(new Set());
      onChanged();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không áp được.');
    } finally {
      setBusy(false);
    }
  };

  let runningIdx = -1;

  return (
    <div ref={boardRef}>
      {editable && (
        <div className="card keyhint-bar" style={{ marginBottom: 12 }}>
          <Keyboard size={16} aria-hidden />
          <span className="keyhint"><span className="kbd">Enter</span> Xác nhận gợi ý</span>
          <span className="keyhint"><span className="kbd">↑</span><span className="kbd">↓</span> Chọn bé</span>
          <span className="keyhint"><span className="kbd">Tab</span> Dòng sau</span>
          <span className="keyhint"><span className="kbd">S</span> Cấp khách</span>
          <span className="keyhint"><span className="kbd">C</span> Chia SL</span>
          <span className="keyhint"><span className="kbd">Esc</span> Đóng</span>
        </div>
      )}

      {editable && (
        <div className="notice notice-success" style={{ marginBottom: 12 }}>
          <Info size={16} aria-hidden />
          <span>
            Hệ thống chỉ <b>gợi ý</b> — mỗi dòng cần căn cứ độc lập. Không có nút “Xác nhận tất cả
            gợi ý”; hồ sơ bé sai còn tệ hơn hồ sơ bé trống.
          </span>
        </div>
      )}

      {editable && checked.size > 0 && (
        <div className="card card-pad between" style={{ marginBottom: 12 }}>
          <span className="small">
            Đã chọn <b>{checked.size}</b> dòng để áp hàng loạt.
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setChecked(new Set())}>
              Bỏ chọn
            </button>
            <button className="btn btn-primary btn-sm" onClick={runBulkPreview} disabled={busy}>
              <Layers size={16} aria-hidden />
              Xem trước áp hàng loạt
            </button>
          </div>
        </div>
      )}

      <div className="stack-4">
        {groups.map((group) => (
          <div key={`${group.customerId ?? group.customerName}`} className="card alloc-group">
            <div className="alloc-group-head">{group.customerName}</div>
            {group.lines.map((line) => {
              runningIdx += 1;
              const idx = runningIdx;
              const isActive = editable && idx === activeIdx;
              const babies = group.customerId ? babyCache[group.customerId] ?? [] : [];
              const selId = currentBabyId(line);
              const selBaby = babies.find((b) => b.id === selId);
              const selName = selBaby?.babyName ?? line.suggestedBaby?.name ?? null;
              return (
                <div
                  key={line.allocationId}
                  className={`alloc-line${isActive ? ' active' : ''}`}
                  onMouseEnter={() => editable && setActiveIdx(idx)}
                >
                  {editable && (
                    <input
                      type="checkbox"
                      checked={checked.has(line.allocationId)}
                      onChange={(e) => {
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(line.allocationId);
                          else next.delete(line.allocationId);
                          return next;
                        });
                      }}
                      aria-label="Chọn dòng để áp hàng loạt"
                      style={{ width: 20, height: 20 }}
                    />
                  )}
                  <div className="alloc-line-main">
                    <div className="alloc-prod">{line.product}</div>
                    <div className="alloc-sub">
                      SL {line.quantity} · mua {line.purchaseDate}
                      {line.confidence && ` · ${confidenceVi[line.confidence] ?? line.confidence}`}
                      {line.skipCount > 0 && ` · đã bỏ qua ${line.skipCount} lần`}
                    </div>
                  </div>

                  {editable ? (
                    <>
                      <div className="stack-2" style={{ gap: 4, minWidth: 130 }}>
                        {selName ? (
                          <Badge tone="attention" icon={false}>
                            <BabyIcon size={13} aria-hidden /> {selName}
                          </Badge>
                        ) : (
                          <Badge tone="neutral" icon={false}>
                            Chưa gợi ý bé
                          </Badge>
                        )}
                        {babies.length > 1 && (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setPickerLine({ line, customerId: group.customerId })}
                          >
                            Bé khác…
                          </button>
                        )}
                      </div>
                      <div className="alloc-actions">
                        <button
                          className="btn btn-confirm"
                          disabled={busy || !selId}
                          onClick={() => confirmLine(line)}
                          title="Xác nhận bé gợi ý (Enter)"
                        >
                          <Check size={18} aria-hidden />
                          ĐÚNG
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => setSplitLine(line)}>
                          <Split size={15} aria-hidden />
                          Chia SL
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => skipLine(line)}>
                          <SkipForward size={15} aria-hidden />
                          Cấp khách
                        </button>
                      </div>
                    </>
                  ) : (
                    <Badge tone={assignmentStatusTone[line.assignmentStatus] ?? 'neutral'} icon={false}>
                      {line.confirmedBaby?.name
                        ? `${assignmentStatusVi[line.assignmentStatus]} · ${line.confirmedBaby.name}`
                        : assignmentStatusVi[line.assignmentStatus] ?? line.assignmentStatus}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {splitLine && (
        <SplitModal
          line={splitLine}
          babies={babiesForLine(splitLine, groups, babyCache)}
          onClose={() => setSplitLine(null)}
          onDone={() => {
            setSplitLine(null);
            onChanged();
          }}
        />
      )}

      {pickerLine && (
        <BabyPickerModal
          babies={pickerLine.customerId ? babyCache[pickerLine.customerId] ?? [] : []}
          currentId={currentBabyId(pickerLine.line)}
          onPick={(babyId) => {
            setSelectedBaby((prev) => ({ ...prev, [pickerLine.line.allocationId]: babyId }));
            setPickerLine(null);
          }}
          onClose={() => setPickerLine(null)}
        />
      )}

      {preview && (
        <BulkPreviewModal
          preview={preview}
          totalSelected={checked.size}
          busy={busy}
          onClose={() => setPreview(null)}
          onApply={applyBulk}
        />
      )}
    </div>
  );
}

function babiesForLine(
  line: AllocationLine,
  groups: AllocationGroup[],
  cache: Record<string, Baby[]>,
): Baby[] {
  const g = groups.find((grp) => grp.lines.some((l) => l.allocationId === line.allocationId));
  if (!g?.customerId) return [];
  return cache[g.customerId] ?? [];
}

function BabyPickerModal({
  babies,
  currentId,
  onPick,
  onClose,
}: {
  babies: Baby[];
  currentId?: string;
  onPick: (babyId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Chọn bé cho dòng hàng" onClose={onClose}>
      {babies.length === 0 ? (
        <EmptyState title="Khách chưa có hồ sơ bé" hint="Thêm bé trong hồ sơ khách trước." />
      ) : (
        <div className="baby-picker">
          {babies.map((b) => (
            <button
              key={b.id}
              className={`baby-option${b.id === currentId ? ' selected' : ''}`}
              onClick={() => onPick(b.id)}
            >
              <span className="row" style={{ gap: 8 }}>
                <BabyIcon size={16} aria-hidden />
                {b.babyName || 'Bé (chưa đặt tên)'}
              </span>
              <span className="caption">{b.ageMonths ?? '?'} tháng</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function SplitModal({
  line,
  babies,
  onClose,
  onDone,
}: {
  line: AllocationLine;
  babies: Baby[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [babyId, setBabyId] = useState(line.suggestedBaby?.id ?? '');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const qtyNum = Number(qty);
  const remaining = line.quantity - (isNaN(qtyNum) ? 0 : qtyNum);
  const valid = babyId && qtyNum > 0 && qtyNum <= line.quantity;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/api/allocations/${line.allocationId}/split`, { babyId, babyQuantity: qtyNum });
      toast('success', 'Đã chia số lượng cho bé; phần còn lại tính cấp khách.');
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không chia được.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Chia số lượng: ${line.product}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!valid || busy}>
            Lưu
          </button>
        </>
      }
    >
      <div className="stack-4">
        <p className="small muted">Tổng SL dòng hàng: <b>{line.quantity}</b></p>
        <div className="field">
          <label className="label" htmlFor="split-baby">
            Gắn cho bé
          </label>
          <select id="split-baby" className="select" value={babyId} onChange={(e) => setBabyId(e.target.value)}>
            <option value="">— Chọn bé —</option>
            {babies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.babyName || 'Bé (chưa đặt tên)'} · {b.ageMonths ?? '?'} tháng
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="split-qty">
            Số lượng gắn cho bé
          </label>
          <input
            id="split-qty"
            className="input"
            type="number"
            min={0}
            max={line.quantity}
            step="0.5"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <span className="caption">
            Còn lại tính cấp khách: <b className="num">{remaining >= 0 ? remaining : 0}</b>
            {qtyNum > line.quantity && ' — vượt quá số lượng dòng hàng, khóa Lưu.'}
          </span>
        </div>
      </div>
    </Modal>
  );
}

function BulkPreviewModal({
  preview,
  totalSelected,
  busy,
  onClose,
  onApply,
}: {
  preview: BulkPreviewResponse;
  totalSelected: number;
  busy: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const eligible = preview.eligibleLineIds.length;
  return (
    <Modal
      title="Xem trước áp hàng loạt"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={onApply} disabled={eligible === 0 || busy}>
            Áp {eligible} dòng đủ điều kiện
          </button>
        </>
      }
    >
      <div className="stack-4">
        <div className="row-wrap" style={{ gap: 8 }}>
          <Badge tone="success" icon={false}>Đủ điều kiện: {eligible}</Badge>
          <Badge tone="warning" icon={false}>Không áp: {preview.rejected.length}</Badge>
          <Badge tone="neutral" icon={false}>Đã chọn: {totalSelected}</Badge>
        </div>
        <p className="small muted">
          Chỉ áp cho dòng cùng khách + cùng hóa đơn + có gợi ý độc lập giống nhau. Các dòng dưới đây
          KHÔNG được áp:
        </p>
        {preview.rejected.length === 0 ? (
          <p className="small">Tất cả dòng đã chọn đều đủ điều kiện.</p>
        ) : (
          <div>
            {preview.rejected.map((r) => (
              <div key={r.lineId} className="preview-line">
                <Badge tone="warning" icon={false}>Bỏ qua</Badge>
                <span className="wrap-anywhere">{r.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

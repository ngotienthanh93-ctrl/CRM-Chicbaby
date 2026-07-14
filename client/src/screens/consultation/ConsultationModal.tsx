import { useMemo, useState } from 'react';
import { AlertTriangle, History, Search, X } from 'lucide-react';
import { api } from '../../api/client';
import type {
  AppointmentResult,
  Baby,
  ConfigResponse,
  Consultation,
  ConsultationDetail,
  Product,
  QuickTemplate,
  Temperature,
} from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Badge, Skeleton } from '../../components/ui';
import { temperatureVi } from '../../lib/labels';
import { fuzzySearchProducts, productLabel } from '../../lib/fuzzy';

interface Deps {
  templates: QuickTemplate[];
  products: Product[];
  babies: Baby[];
}

const RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '— Chưa ghi nhận —' },
  { value: 'da_chot', label: 'Đã chốt' },
  { value: 'chua_chot', label: 'Chưa chốt' },
  { value: 'tu_choi', label: 'Từ chối' },
];

const TEMPERATURES: Temperature[] = ['nong', 'am', 'lanh'];

/**
 * SCR-06 Ghi chú tư vấn (§11.2 CON-01..09). Mở nhanh từ SCR-04 (tab Tư vấn) và SCR-02.
 * 🔴 issue bắt buộc DUY NHẤT; temperature KHÔNG mặc định; result='da_chot' KHÔNG phải giao dịch thật.
 * Sửa KHÔNG ghi đè (server lưu consultation_versions) — hiển thị "đã sửa N lần".
 */
export function ConsultationModal({
  customerId,
  existing,
  onClose,
  onSaved,
}: {
  customerId: string;
  existing?: Consultation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const deps = useApi<Deps>(async () => {
    const [cfg, prods, babyRes] = await Promise.all([
      api.get<ConfigResponse>('/api/config'),
      api.get<{ items: Product[] }>('/api/products'),
      api
        .get<{ items: Baby[] }>(`/api/customers/${customerId}/babies`)
        .catch(() => ({ items: [] as Baby[] })),
    ]);
    const tplItem = cfg.items.find((i) => i.key === 'consultation.quick_templates');
    const templates = Array.isArray(tplItem?.value) ? (tplItem!.value as QuickTemplate[]) : [];
    return { templates, products: prods.items, babies: babyRes.items };
  }, [customerId]);

  return (
    <Modal title={existing ? 'Sửa ghi chú tư vấn' : 'Ghi chú tư vấn'} onClose={onClose}>
      {deps.status === 'loading' && (
        <div className="stack-4">
          <Skeleton h={44} />
          <Skeleton h={44} />
          <Skeleton h={88} />
        </div>
      )}
      {deps.status === 'error' && (
        <p className="small muted">Không tải được dữ liệu mẫu/sản phẩm. Đóng và thử lại.</p>
      )}
      {deps.status === 'success' && (
        <ConsultationForm
          customerId={customerId}
          existing={existing}
          deps={deps.data}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function ConsultationForm({
  customerId,
  existing,
  deps,
  onClose,
  onSaved,
}: {
  customerId: string;
  existing?: Consultation | null;
  deps: Deps;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [issue, setIssue] = useState(existing?.issue ?? '');
  const [babyId, setBabyId] = useState(existing?.babyId ?? '');
  const [temperature, setTemperature] = useState<Temperature | ''>(
    (existing?.temperature as Temperature | null) ?? '',
  );
  const [result, setResult] = useState(existing?.result ?? '');
  const [reasonNoBuy, setReasonNoBuy] = useState(existing?.reasonNoBuy ?? '');
  const [nextContactDate, setNextContactDate] = useState(toDateInput(existing?.nextContactDate));
  const [note, setNote] = useState(existing?.note ?? '');
  const [advised, setAdvised] = useState<string[]>(existing?.advisedProductIds ?? []);
  const [productFilter, setProductFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const productById = useMemo(
    () => new Map(deps.products.map((p) => [p.kvProductId, p])),
    [deps.products],
  );
  // Tìm gợi ý gần đúng: chịu thiếu dấu tiếng Việt + sai chính tả nhẹ (xem lib/fuzzy).
  const filteredProducts = useMemo(
    () => fuzzySearchProducts(deps.products, productFilter, 40),
    [deps.products, productFilter],
  );

  // result != 'da_chot' (và != rỗng) ⇒ hỏi lý do chưa mua.
  const showReasonNoBuy = result !== '' && result !== 'da_chot';
  const canSave = issue.trim().length > 0 && !busy;

  const toggleAdvised = (id: string) =>
    setAdvised((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addRelativeDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setNextContactDate(d.toISOString().slice(0, 10));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const nextIso = nextContactDate ? new Date(nextContactDate).toISOString() : null;
      let res: ConsultationDetail & { appointment?: AppointmentResult };
      if (existing) {
        // Sửa: gửi null để xóa trường; server lưu snapshot bản cũ (CON-03).
        // 🔴 FIX-3 (CONC-03): BẮT BUỘC gửi version để khóa lạc quan (server 409 nếu bản đã đổi).
        res = await api.put<ConsultationDetail & { appointment?: AppointmentResult }>(
          `/api/consultations/${existing.id}`,
          {
            issue: issue.trim(),
            babyId: babyId || null,
            advisedProductIds: advised,
            temperature: temperature || null,
            result: result || null,
            reasonNoBuy: showReasonNoBuy ? reasonNoBuy.trim() || null : null,
            nextContactDate: nextIso,
            note: note.trim() || null,
            version: existing.version,
          },
        );
        toast('success', 'Đã cập nhật ghi chú tư vấn (bản cũ được lưu lịch sử).');
      } else {
        res = await api.post<ConsultationDetail & { appointment?: AppointmentResult }>(
          '/api/consultations',
          {
            customerId,
            issue: issue.trim(),
            babyId: babyId || undefined,
            advisedProductIds: advised.length ? advised : undefined,
            temperature: temperature || undefined,
            result: result || undefined,
            reasonNoBuy: showReasonNoBuy && reasonNoBuy.trim() ? reasonNoBuy.trim() : undefined,
            nextContactDate: nextIso ?? undefined,
            note: note.trim() || undefined,
          },
        );
        toast('success', 'Đã lưu ghi chú tư vấn.');
      }
      // Phản hồi lịch hẹn gọi lại (CON-04/05).
      const ap = res.appointment;
      if (ap?.reason === 'created') toast('info', 'Đã tạo lịch gọi lại (không bị trần chống làm phiền).');
      else if (ap?.reason === 'duplicate_within_window')
        toast('info', 'Đã có lịch hẹn gần ngày này (±3 ngày) — không tạo trùng.');
      onSaved();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không lưu được, thử lại.');
      setBusy(false);
    }
  };

  return (
    <div className="stack-4">
      {existing && existing.editedCount > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <Badge tone="neutral" icon={false}>
            <History size={12} aria-hidden /> Đã sửa {existing.editedCount} lần
          </Badge>
          <span className="caption">Mỗi lần sửa lưu bản cũ vào lịch sử, không ghi đè.</span>
        </div>
      )}

      {/* Vấn đề — bắt buộc DUY NHẤT (CON-01) */}
      <div className="field">
        <label className="label" htmlFor="con-issue">
          Vấn đề của khách/bé <span className="req">*</span>
        </label>
        <input
          id="con-issue"
          className="input"
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="VD: Bé táo bón, hỏi men vi sinh"
          autoFocus
        />
        <div className="row-wrap" style={{ gap: 6, marginTop: 6 }}>
          <span className="caption">Điền nhanh:</span>
          {deps.templates.map((t) => (
            <button
              key={t.group}
              type="button"
              className="chip"
              onClick={() => t.issue && setIssue(t.issue)}
              disabled={!t.issue}
              title={t.issue || 'Nhóm khác — tự nhập'}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bé liên quan (không bắt buộc) */}
      {deps.babies.length > 0 && (
        <div className="field">
          <label className="label" htmlFor="con-baby">
            Bé liên quan <span className="muted">(không bắt buộc)</span>
          </label>
          <select
            id="con-baby"
            className="select"
            value={babyId}
            onChange={(e) => setBabyId(e.target.value)}
          >
            <option value="">— Không gắn bé —</option>
            {deps.babies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.babyName || 'Bé (chưa đặt tên)'}
                {b.ageMonths != null ? ` · ${b.ageMonths} tháng` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Nhiệt độ khách — 🔴 KHÔNG chọn sẵn (CON-01) */}
      <div className="field">
        <span className="label">Mức độ quan tâm của khách</span>
        <div className="segmented" role="group" aria-label="Mức độ quan tâm">
          {TEMPERATURES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={temperature === t}
              onClick={() => setTemperature((cur) => (cur === t ? '' : t))}
            >
              {temperatureVi[t]}
            </button>
          ))}
        </div>
        <span className="caption">Không chọn sẵn — chỉ ghi khi thực sự đánh giá được.</span>
      </div>

      {/* SP đã tư vấn (multi) */}
      <div className="field">
        <span className="label">
          Sản phẩm đã tư vấn <span className="muted">(không bắt buộc)</span>
        </span>
        {advised.length > 0 && (
          <div className="row-wrap" style={{ gap: 6, marginBottom: 6 }}>
            {advised.map((id) => {
              const p = productById.get(id);
              return (
                <span key={id} className="chip chip-active">
                  {p ? productLabel(p) : id}
                  <button
                    type="button"
                    className="chip-x"
                    aria-label="Bỏ chọn"
                    onClick={() => toggleAdvised(id)}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="search-box" style={{ marginBottom: 6 }}>
          <Search size={16} className="search-icon" aria-hidden />
          <input
            className="input"
            placeholder="Tìm sản phẩm để thêm…"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            aria-label="Tìm sản phẩm tư vấn"
          />
        </div>
        <div className="pick-list">
          {filteredProducts.map((p) => {
            const checked = advised.includes(p.kvProductId);
            return (
              <button
                key={p.kvProductId}
                type="button"
                className={`pick-row${checked ? ' selected' : ''}`}
                onClick={() => toggleAdvised(p.kvProductId)}
                aria-pressed={checked}
              >
                <span className="grow wrap-anywhere">{productLabel(p)}</span>
                {checked && <Badge tone="success" icon={false}>Đã chọn</Badge>}
              </button>
            );
          })}
          {filteredProducts.length === 0 && (
            <p className="caption" style={{ padding: 8 }}>Không có sản phẩm khớp.</p>
          )}
        </div>
      </div>

      {/* Kết quả */}
      <div className="field">
        <label className="label" htmlFor="con-result">
          Kết quả tư vấn
        </label>
        <select
          id="con-result"
          className="select"
          value={result}
          onChange={(e) => setResult(e.target.value)}
        >
          {RESULT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {result === 'da_chot' && (
          <span className="caption">
            "Đã chốt" là ghi nhận tư vấn — KHÔNG tính là giao dịch thật (chỉ hóa đơn KiotViet xác minh).
          </span>
        )}
      </div>

      {showReasonNoBuy && (
        <div className="field">
          <label className="label" htmlFor="con-reason">
            Lý do chưa mua
          </label>
          <input
            id="con-reason"
            className="input"
            value={reasonNoBuy}
            onChange={(e) => setReasonNoBuy(e.target.value)}
            placeholder="VD: đang so sánh giá, chờ hỏi ý kiến chồng…"
          />
        </div>
      )}

      {/* Ngày liên hệ lại */}
      <div className="field">
        <label className="label" htmlFor="con-next">
          Hẹn liên hệ lại <span className="muted">(không bắt buộc)</span>
        </label>
        <input
          id="con-next"
          className="input"
          type="date"
          value={nextContactDate}
          onChange={(e) => setNextContactDate(e.target.value)}
        />
        <div className="row-wrap" style={{ gap: 6, marginTop: 6 }}>
          {[3, 7, 14].map((d) => (
            <button key={d} type="button" className="chip" onClick={() => addRelativeDate(d)}>
              +{d} ngày
            </button>
          ))}
          {nextContactDate && (
            <button type="button" className="chip" onClick={() => setNextContactDate('')}>
              Xóa hẹn
            </button>
          )}
        </div>
        <span className="caption">Đặt hẹn sẽ tạo việc "gọi lại tư vấn" (không bị trần chống làm phiền).</span>
      </div>

      {/* Ghi chú */}
      <div className="field">
        <label className="label" htmlFor="con-note">
          Ghi chú chi tiết
        </label>
        <textarea
          id="con-note"
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="disclaimer">
        <AlertTriangle size={16} aria-hidden />
        <span>
          Thông tin do khách hàng cung cấp, KHÔNG phải chẩn đoán y tế. Không thay thế tư vấn của bác sĩ.
        </span>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={onClose} disabled={busy}>
          Hủy
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={!canSave}>
          {busy ? 'Đang lưu…' : existing ? 'Lưu thay đổi' : 'Lưu tư vấn'}
        </button>
      </div>
    </div>
  );
}

/** ISO/`dd/mm/yyyy` -> value cho <input type=date> (yyyy-mm-dd). Rỗng nếu không parse được. */
function toDateInput(v: string | null | undefined): string {
  if (!v) return '';
  // Server trả nextContactDate theo formatVnDate = dd/mm/yyyy.
  const vn = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (vn) return `${vn[3]}-${vn[2]}-${vn[1]}`;
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../../api/client';
import type { ExperimentDTO, RoleKey, SystemConfigResponse } from '../../api/types';
import { roleVi } from '../../lib/labels';
import { ReauthModal } from '../admin/ReauthModal';
import {
  DEFAULT_HOLDOUT_PCT,
  DEFAULT_MIN_SAMPLE_HOLDOUT,
  DEFAULT_MIN_SAMPLE_TREATMENT,
  HARD_EXCLUSION_RULES,
  HOLDOUT_PCT_MAX,
  HOLDOUT_PCT_MIN,
} from './experimentLabels';

const ROLE_OPTIONS: RoleKey[] = ['chu_shop', 'crm_officer', 'cskh', 'marketing', 'tro_ly_du_lieu'];

/** ISO (UTC) → chuỗi cho input datetime-local (giờ máy người dùng). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
/** Chuỗi datetime-local (giờ máy) → ISO (UTC) để gửi server. */
function toISO(local: string): string {
  return new Date(local).toISOString();
}

/**
 * Form Tạo/Sửa thí nghiệm holdout.
 * 🔴 endAt BẮT BUỘC; holdoutRatio 10–15%; 6 luật loại trừ khóa cứng (tick+disabled).
 * 🔴 Tạo/Sửa ⇒ nhập lại mật khẩu (EXP-05) qua ReauthModal.
 */
export function ExperimentFormModal({
  mode,
  experiment,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit';
  experiment?: ExperimentDTO;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(experiment?.name ?? '');
  const [startAt, setStartAt] = useState(toLocalInput(experiment?.startAt ?? null));
  const [endAt, setEndAt] = useState(toLocalInput(experiment?.endAt ?? null));
  const [holdoutPct, setHoldoutPct] = useState(
    experiment ? String(experiment.holdoutRatio * 100) : String(DEFAULT_HOLDOUT_PCT),
  );
  // 🔴 Nguyên tắc #9: khi TẠO mới, lấy tỉ lệ holdout mặc định từ CẤU HÌNH ACTIVE (experiment.holdout_ratio),
  // không cứng 10%. Chỉ prefill khi user CHƯA chỉnh field (tránh đè giá trị người dùng gõ).
  const [pctTouched, setPctTouched] = useState(false);
  useEffect(() => {
    if (mode !== 'create' || pctTouched) return;
    let alive = true;
    api
      .get<SystemConfigResponse>('/api/config')
      .then((r) => {
        const row = r.items.find((i) => i.key === 'experiment.holdout_ratio');
        if (alive && !pctTouched && row && typeof row.value === 'number') {
          setHoldoutPct(String(row.value * 100));
        }
      })
      .catch(() => {
        /* giữ mặc định app nếu không đọc được cấu hình */
      });
    return () => {
      alive = false;
    };
  }, [mode, pctTouched]);
  const [minTreatment, setMinTreatment] = useState(
    String(experiment?.minSampleTreatment ?? DEFAULT_MIN_SAMPLE_TREATMENT),
  );
  const [minHoldout, setMinHoldout] = useState(
    String(experiment?.minSampleHoldout ?? DEFAULT_MIN_SAMPLE_HOLDOUT),
  );
  const [roles, setRoles] = useState<string[]>(experiment?.scope.roles ?? []);
  const [productGroups, setProductGroups] = useState((experiment?.scope.productGroups ?? []).join(', '));

  const pct = Number(holdoutPct);
  const nT = Number(minTreatment);
  const nH = Number(minHoldout);
  const nameOk = name.trim().length > 0;
  const startOk = mode === 'edit' || startAt !== '';
  const endOk = endAt !== '';
  const rangeOk = mode === 'edit' ? true : startAt !== '' && endAt !== '' && new Date(endAt) > new Date(startAt);
  const pctOk = Number.isFinite(pct) && pct >= HOLDOUT_PCT_MIN && pct <= HOLDOUT_PCT_MAX;
  const samplesOk = Number.isInteger(nT) && nT > 0 && Number.isInteger(nH) && nH > 0;
  const disabled = !(nameOk && startOk && endOk && rangeOk && pctOk && samplesOk);

  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const submit = async (password: string): Promise<void> => {
    const parsedGroups = productGroups
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const common = {
      name: name.trim(),
      endAt: toISO(endAt),
      minSampleTreatment: nT,
      minSampleHoldout: nH,
      appliesToRoles: roles,
      appliesToProductGroups: parsedGroups,
      password,
    };
    if (mode === 'create') {
      // 🔴 Nguyên tắc #9: nếu user CHƯA chỉnh tỉ lệ, KHÔNG gửi holdoutRatio ⇒ server tự áp default
      // cấu hình active (activeHoldoutRatioDefault). Tránh race khi /api/config chưa/không trả về.
      const payload = pctTouched
        ? { ...common, holdoutRatio: pct / 100, startAt: toISO(startAt) }
        : { ...common, startAt: toISO(startAt) };
      await api.post('/api/experiments', payload);
      return;
    }
    // 🔴 PUT không nhận startAt (không đổi mốc bắt đầu sau khi tạo). Edit LUÔN gửi tỉ lệ đang hiển thị.
    await api.put(`/api/experiments/${experiment!.id}`, { ...common, holdoutRatio: pct / 100 });
  };

  return (
    <ReauthModal
      title={mode === 'create' ? 'Tạo thí nghiệm holdout' : `Sửa thí nghiệm: ${experiment?.name}`}
      submitLabel={mode === 'create' ? 'Tạo thí nghiệm' : 'Lưu thay đổi'}
      disabled={disabled}
      warning={
        <div className="notice notice-neutral">
          <span className="small">
            Thao tác được ghi nhật ký (EXP-05). Phân nhóm theo hash(khách + thí nghiệm) — mỗi khách
            luôn một nhóm; việc holdout KHÔNG hiện ở Việc hôm nay.
          </span>
        </div>
      }
      onClose={onClose}
      onSubmit={submit}
      onDone={onDone}
    >
      <div className="field">
        <label className="label" htmlFor="exp-name">
          Tên thí nghiệm <span className="req">*</span>
        </label>
        <input
          id="exp-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="row-wrap" style={{ gap: 12 }}>
        <div className="field" style={{ flex: '1 1 180px' }}>
          <label className="label" htmlFor="exp-start">
            Bắt đầu <span className="req">*</span>
          </label>
          <input
            id="exp-start"
            className="input"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            disabled={mode === 'edit'}
          />
          {mode === 'edit' && <span className="caption">Không đổi được mốc bắt đầu sau khi tạo.</span>}
        </div>
        <div className="field" style={{ flex: '1 1 180px' }}>
          <label className="label" htmlFor="exp-end">
            Kết thúc <span className="req">*</span>
          </label>
          <input
            id="exp-end"
            className="input"
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
          />
          {!rangeOk && endAt !== '' && (
            <span className="caption" style={{ color: 'var(--c-danger)' }}>
              Kết thúc phải sau thời điểm bắt đầu.
            </span>
          )}
        </div>
      </div>

      <div className="row-wrap" style={{ gap: 12 }}>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label className="label" htmlFor="exp-holdout">
            Tỉ lệ holdout (%) <span className="req">*</span>
          </label>
          <input
            id="exp-holdout"
            className="input"
            type="number"
            step="0.5"
            min={HOLDOUT_PCT_MIN}
            max={HOLDOUT_PCT_MAX}
            value={holdoutPct}
            onChange={(e) => {
              setPctTouched(true);
              setHoldoutPct(e.target.value);
            }}
          />
          <span className="caption" style={{ color: pctOk ? undefined : 'var(--c-danger)' }}>
            Cho phép {HOLDOUT_PCT_MIN}–{HOLDOUT_PCT_MAX}%.
          </span>
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label className="label" htmlFor="exp-mint">
            Mẫu tối thiểu (treatment)
          </label>
          <input
            id="exp-mint"
            className="input"
            type="number"
            min={1}
            value={minTreatment}
            onChange={(e) => setMinTreatment(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label className="label" htmlFor="exp-minh">
            Mẫu tối thiểu (holdout)
          </label>
          <input
            id="exp-minh"
            className="input"
            type="number"
            min={1}
            value={minHoldout}
            onChange={(e) => setMinHoldout(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="label">Vai áp dụng</legend>
        <div className="row-wrap" style={{ gap: 8 }}>
          {ROLE_OPTIONS.map((r) => (
            <label key={r} className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
              <span className="small">{roleVi[r] ?? r}</span>
            </label>
          ))}
        </div>
        <span className="caption">Bỏ trống = áp dụng mọi vai.</span>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="exp-groups">
          Nhóm sản phẩm áp dụng
        </label>
        <input
          id="exp-groups"
          className="input"
          value={productGroups}
          onChange={(e) => setProductGroups(e.target.value)}
          placeholder="Nhập mã/nhóm, phân tách bằng dấu phẩy. Bỏ trống = mọi nhóm."
        />
      </div>

      <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="label">Luật loại trừ khóa cứng</legend>
        <div className="notice notice-warning" style={{ marginBottom: 8 }}>
          <Lock size={16} aria-hidden />
          <span className="small">
            6 luật sau LUÔN bật (khóa cứng, không thể tắt) — bảo vệ khách/việc quan trọng khỏi bị đưa
            vào nhóm holdout.
          </span>
        </div>
        <div className="stack-2" style={{ gap: 4 }}>
          {HARD_EXCLUSION_RULES.map((rule) => (
            <label key={rule.key} className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked disabled aria-label={rule.label} />
              <span className="small muted">{rule.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </ReauthModal>
  );
}

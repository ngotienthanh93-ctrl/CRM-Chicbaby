import { useState } from 'react';
import { Plus, Pencil, Trash2, Baby as BabyIcon, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import type { Baby } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/Toast';
import { Modal } from '../../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../../components/ui';

const AGE_STAGE_LABEL: Record<string, string> = {
  '0-6': '0–6 tháng',
  '6-12': '6–12 tháng',
  '12-36': '1–3 tuổi',
  '36+': 'Trên 3 tuổi',
};

export function BabyTab({ customerId }: { customerId: string }) {
  const state = useApi<{ items: Baby[] }>(
    () => api.get(`/api/customers/${customerId}/babies`),
    [customerId],
  );
  const [editing, setEditing] = useState<Baby | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Baby | null>(null);

  return (
    <div className="stack-4">
      <div className="disclaimer">
        <AlertTriangle size={16} aria-hidden />
        <span>
          Thông tin do khách hàng cung cấp, KHÔNG phải chẩn đoán y tế. Không thay thế tư vấn của bác sĩ.
        </span>
      </div>

      <div className="between">
        <h3 className="h3">Hồ sơ bé</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden />
          Thêm bé
        </button>
      </div>

      {state.status === 'loading' && <SkeletonCards count={2} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState
            icon={<BabyIcon size={26} />}
            title="Chưa có hồ sơ bé"
            hint="Thêm bé để nhắc tái mua đúng theo bé (không bắt buộc tên bé)."
            action={
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                <Plus size={16} aria-hidden />
                Thêm bé đầu tiên
              </button>
            }
          />
        ) : (
          <div className="stack">
            {state.data.items.map((b) => (
              <div key={b.id} className="card baby-card">
                <div className="between">
                  <div className="row" style={{ gap: 8 }}>
                    <BabyIcon size={18} aria-hidden className="muted" />
                    <b>{b.babyName || 'Bé (chưa đặt tên)'}</b>
                    {b.ageStage && (
                      <Badge tone="primary" icon={false}>
                        {AGE_STAGE_LABEL[b.ageStage] ?? b.ageStage}
                      </Badge>
                    )}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => setEditing(b)}
                      aria-label="Sửa bé"
                    >
                      <Pencil size={16} aria-hidden />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => setDeleting(b)}
                      aria-label="Xóa bé"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="baby-age">
                  {b.ageMonths != null ? `${b.ageMonths} tháng` : 'Chưa rõ tuổi'}
                  <span className="caption" style={{ marginLeft: 8, fontWeight: 400 }}>
                    {b.datePrecision === 'exact' && b.birthDate
                      ? `(ngày sinh ${b.birthDate})`
                      : '(ước tính từ tháng tuổi đã ghi nhận)'}
                  </span>
                </div>
                {(b.gender || b.allergies || b.condition || b.note) && (
                  <div className="stack-2" style={{ gap: 4 }}>
                    {b.gender && <div className="small"><b>Giới tính:</b> {genderVi(b.gender)}</div>}
                    {b.allergies && <div className="small"><b>Dị ứng:</b> {b.allergies}</div>}
                    {b.condition && <div className="small"><b>Tình trạng:</b> {b.condition}</div>}
                    {b.note && <div className="small wrap-anywhere"><b>Ghi chú:</b> {b.note}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

      {editing && (
        <BabyModal
          customerId={customerId}
          baby={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      )}

      {deleting && (
        <DeleteBabyModal
          baby={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            state.reload();
          }}
        />
      )}
    </div>
  );
}

function genderVi(g: string): string {
  if (g === 'male' || g === 'nam') return 'Bé trai';
  if (g === 'female' || g === 'nu') return 'Bé gái';
  return g;
}

function BabyModal({
  customerId,
  baby,
  onClose,
  onSaved,
}: {
  customerId: string;
  baby: Baby | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = !!baby;
  const [mode, setMode] = useState<'age' | 'birth'>(
    baby?.datePrecision === 'exact' ? 'birth' : 'age',
  );
  const [babyName, setBabyName] = useState(baby?.babyName ?? '');
  const [ageMonths, setAgeMonths] = useState(
    baby?.datePrecision !== 'exact' && baby?.ageMonths != null ? String(baby.ageMonths) : '',
  );
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState(baby?.gender ?? '');
  const [allergies, setAllergies] = useState(baby?.allergies ?? '');
  const [condition, setCondition] = useState(baby?.condition ?? '');
  const [note, setNote] = useState(baby?.note ?? '');
  const [busy, setBusy] = useState(false);

  const canSave =
    mode === 'age' ? ageMonths.trim() !== '' && Number(ageMonths) >= 0 : birthDate !== '';

  const submit = async () => {
    setBusy(true);
    try {
      const base: Record<string, unknown> = {
        babyName: babyName.trim() || null,
        gender: gender || null,
        allergies: allergies.trim() || null,
        condition: condition.trim() || null,
        note: note.trim() || null,
      };
      if (mode === 'age') {
        base.ageMonthsAtRecording = Number(ageMonths);
        base.birthDate = null;
      } else {
        base.birthDate = new Date(birthDate).toISOString();
      }
      if (isEdit) {
        await api.put(`/api/babies/${baby!.id}`, base);
        toast('success', 'Đã cập nhật hồ sơ bé.');
      } else {
        await api.post('/api/babies', { customerId, ...base });
        toast('success', 'Đã thêm hồ sơ bé.');
      }
      onSaved();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không lưu được, thử lại.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Sửa hồ sơ bé' : 'Thêm hồ sơ bé'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSave || busy}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </>
      }
    >
      <div className="stack-4">
        <div className="field">
          <label className="label" htmlFor="baby-name">
            Tên bé <span className="muted">(không bắt buộc)</span>
          </label>
          <input
            id="baby-name"
            className="input"
            value={babyName}
            onChange={(e) => setBabyName(e.target.value)}
            placeholder="Bé Bin…"
          />
        </div>

        <div className="field">
          <span className="label">Nhập tuổi theo</span>
          <div className="segmented" role="group">
            <button type="button" aria-pressed={mode === 'age'} onClick={() => setMode('age')}>
              Số tháng tuổi
            </button>
            <button type="button" aria-pressed={mode === 'birth'} onClick={() => setMode('birth')}>
              Ngày sinh
            </button>
          </div>
        </div>

        {mode === 'age' ? (
          <div className="field">
            <label className="label" htmlFor="baby-age">
              Số tháng tuổi hiện tại
            </label>
            <input
              id="baby-age"
              className="input"
              type="number"
              min={0}
              max={216}
              value={ageMonths}
              onChange={(e) => setAgeMonths(e.target.value)}
              placeholder="Ví dụ 8"
            />
            <span className="caption">Hệ thống sẽ tự tính tuổi trôi theo thời gian.</span>
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="baby-birth">
              Ngày sinh
            </label>
            <input
              id="baby-birth"
              className="input"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="baby-gender">
            Giới tính
          </label>
          <select
            id="baby-gender"
            className="select"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          >
            <option value="">Chưa rõ</option>
            <option value="male">Bé trai</option>
            <option value="female">Bé gái</option>
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="baby-allergies">
            Dị ứng
          </label>
          <input
            id="baby-allergies"
            className="input"
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            placeholder="Do mẹ/bé cung cấp"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="baby-condition">
            Tình trạng đặc biệt
          </label>
          <input
            id="baby-condition"
            className="input"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="baby-note">
            Ghi chú
          </label>
          <textarea
            id="baby-note"
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function DeleteBabyModal({
  baby,
  onClose,
  onDeleted,
}: {
  baby: Baby;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try {
      await api.del(`/api/babies/${baby.id}`);
      toast('success', 'Đã xóa hồ sơ bé.');
      onDeleted();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Không xóa được, thử lại.');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Xóa hồ sơ bé?"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Giữ lại
          </button>
          <button className="btn btn-danger" onClick={del} disabled={busy}>
            {busy ? 'Đang xóa…' : 'Xóa bé'}
          </button>
        </>
      }
    >
      <div className="stack-2">
        <p>
          Xóa hồ sơ <b>{baby.babyName || 'bé (chưa đặt tên)'}</b>. Hệ quả:
        </p>
        <ul className="stack-2" style={{ paddingLeft: 18, listStyle: 'disc' }}>
          <li className="small">Phân bổ hóa đơn đã xác nhận cho bé được GIỮ NGUYÊN.</li>
          <li className="small">Các nhắc đang mở của bé được hạ về cấp khách (không mất việc).</li>
          <li className="small">Tư vấn liên quan được giữ, đánh dấu "bé đã xóa".</li>
        </ul>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw, Lock } from 'lucide-react';
import { api } from '../../api/client';
import type {
  FieldLevel,
  Permissions,
  RoleMatrix,
  RoleMatrixRow,
  RoleOverridePayload,
  SensitiveFields,
} from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { useToast } from '../../components/Toast';
import { Badge, ErrorState, SkeletonTable } from '../../components/ui';
import { roleVi } from '../../lib/labels';
import { fieldLabelVi, fieldLevelVi, flagLabelVi } from './adminLabels';
import { ReauthModal, RevokeWarning } from './ReauthModal';

/** Trạng thái chỉnh sửa cho một vai (chỉ cờ override được + 5 trường + export). */
interface RoleEdit {
  flags: Record<string, boolean>;
  fields: SensitiveFields;
}
type EditState = Record<string, RoleEdit>;

const FIELD_KEYS: (keyof SensitiveFields)[] = ['phone', 'address', 'baby', 'consultation', 'debt'];

function flagVal(flags: Permissions, key: string): boolean {
  return Boolean(flags[key as keyof Permissions]);
}

/** Dựng trạng thái chỉnh sửa từ ma trận (chỉ giữ cờ override được để gửi lên). */
function buildEdit(matrix: RoleMatrix): EditState {
  const out: EditState = {};
  for (const r of matrix.rows) {
    if (r.locked) continue; // chu_shop khóa cứng — không chỉnh
    const flags: Record<string, boolean> = {};
    for (const f of matrix.overridableFlags) flags[f] = flagVal(r.flags, f);
    out[r.role] = { flags, fields: { ...r.fields } };
  }
  return out;
}

function editFromDefaults(matrix: RoleMatrix, row: RoleMatrixRow): RoleEdit {
  const flags: Record<string, boolean> = {};
  for (const f of matrix.overridableFlags) flags[f] = flagVal(row.defaultFlags, f);
  return { flags, fields: { ...row.defaultFields } };
}

export function RolesTab() {
  const state = useApi<RoleMatrix>(() => api.get('/api/admin/roles'), []);
  if (state.status === 'loading') return <SkeletonTable rows={6} cols={6} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  return <RolesEditor matrix={state.data} onSaved={state.reload} />;
}

function RolesEditor({ matrix, onSaved }: { matrix: RoleMatrix; onSaved: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<EditState>(() => buildEdit(matrix));
  const [saving, setSaving] = useState(false);

  // Đồng bộ lại khi ma trận mới về (sau khi lưu & reload) — xoá trạng thái "chưa lưu".
  useEffect(() => {
    setEdit(buildEdit(matrix));
  }, [matrix]);

  const pristine = useMemo(() => buildEdit(matrix), [matrix]);
  const dirty = JSON.stringify(edit) !== JSON.stringify(pristine);

  const rowByRole = useMemo(
    () => new Map<string, RoleMatrixRow>(matrix.rows.map((r) => [r.role, r])),
    [matrix.rows],
  );
  const editableRoles = matrix.rows.filter((r) => !r.locked);

  const setFlag = (role: string, flag: string, val: boolean) =>
    setEdit((prev) => ({ ...prev, [role]: { ...prev[role], flags: { ...prev[role].flags, [flag]: val } } }));

  const setField = (role: string, field: keyof SensitiveFields, val: FieldLevel | boolean) =>
    setEdit((prev) => ({ ...prev, [role]: { ...prev[role], fields: { ...prev[role].fields, [field]: val } } }));

  const resetRole = (role: string) => {
    const row = rowByRole.get(role);
    if (!row) return;
    setEdit((prev) => ({ ...prev, [role]: editFromDefaults(matrix, row) }));
  };

  const buildPayload = (): Record<string, RoleOverridePayload> => {
    const overrides: Record<string, RoleOverridePayload> = {};
    for (const role of Object.keys(edit)) {
      overrides[role] = { flags: edit[role].flags, fields: edit[role].fields };
    }
    return overrides;
  };

  return (
    <div className="stack-4">
      <div className="notice notice-warning">
        <Lock size={16} aria-hidden />
        <span className="small">
          Đổi quyền áp dụng NGAY ở mọi phiên đang mở. Vai Chủ shop khóa cứng — không chỉnh được. Với 3
          cờ xem nhạy cảm, mức quyền TRƯỜNG (bên dưới) là nguồn quyết định.
        </span>
      </div>

      {/* Ma trận Vai × cờ hành động */}
      <section className="card card-pad stack-2">
        <h3 className="h3">Ma trận vai × hành động</h3>
        <div className="list-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Hành động</th>
                {matrix.rows.map((r) => (
                  <th key={r.role} style={{ textAlign: 'center' }}>
                    <div className="stack-2" style={{ gap: 2, alignItems: 'center' }}>
                      <span>{roleVi[r.role] ?? r.role}</span>
                      {r.locked && <Badge tone="neutral" icon={false}>Khóa cứng</Badge>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.overridableFlags.map((flag) => (
                <FlagRow
                  key={flag}
                  flag={flag}
                  locked={false}
                  rows={matrix.rows}
                  edit={edit}
                  onToggle={setFlag}
                />
              ))}
              {matrix.lockedFlags.map((flag) => (
                <FlagRow
                  key={flag}
                  flag={flag}
                  locked
                  rows={matrix.rows}
                  edit={edit}
                  onToggle={setFlag}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption">
          Cột "Khóa cứng" (Chủ shop) và các cờ quản trị (nền mờ) không chỉnh được — bảo vệ quyền quản
          trị khỏi bị vô hiệu.
        </p>
      </section>

      {/* Quyền trường nhạy cảm */}
      <section className="card card-pad stack-2">
        <h3 className="h3">Quyền trường nhạy cảm</h3>
        <div className="list-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Trường</th>
                {matrix.rows.map((r) => (
                  <th key={r.role} style={{ textAlign: 'center' }}>
                    {roleVi[r.role] ?? r.role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELD_KEYS.map((field) => (
                <tr key={field}>
                  <td>{fieldLabelVi[field] ?? field}</td>
                  {matrix.rows.map((r) => (
                    <td key={r.role} style={{ textAlign: 'center' }}>
                      {r.locked ? (
                        <span className="small muted">{fieldLevelVi[r.fields[field] as FieldLevel]}</span>
                      ) : (
                        <select
                          className="select"
                          aria-label={`${fieldLabelVi[field]} — ${roleVi[r.role]}`}
                          value={edit[r.role]?.fields[field] as FieldLevel}
                          onChange={(e) => setField(r.role, field, e.target.value as FieldLevel)}
                        >
                          {matrix.fieldLevels.map((lv) => (
                            <option key={lv} value={lv}>
                              {fieldLevelVi[lv]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Cho phép Export */}
              <tr>
                <td>Cho phép Export</td>
                {matrix.rows.map((r) => (
                  <td key={r.role} style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`Cho phép Export — ${roleVi[r.role]}`}
                      checked={r.locked ? r.fields.exportAllowed : !!edit[r.role]?.fields.exportAllowed}
                      disabled={r.locked}
                      onChange={(e) => setField(r.role, 'exportAllowed', e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Khôi phục mặc định + Lưu */}
      <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
          <span className="caption">Khôi phục mặc định:</span>
          {editableRoles.map((r) => (
            <button key={r.role} className="btn btn-ghost btn-sm" onClick={() => resetRole(r.role)}>
              <RotateCcw size={14} aria-hidden />
              {roleVi[r.role] ?? r.role}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => setSaving(true)}>
          <Save size={16} aria-hidden />
          Lưu ma trận quyền
        </button>
      </div>

      {saving && (
        <ReauthModal
          title="Lưu ma trận quyền"
          submitLabel="Lưu & áp dụng"
          danger
          warning={<RevokeWarning text="Quyền mới áp dụng NGAY ở mọi phiên đang mở. Thao tác được ghi nhật ký (versioned)." />}
          onClose={() => setSaving(false)}
          onSubmit={(password) => api.put('/api/admin/roles', { overrides: buildPayload(), password })}
          onDone={() => {
            setSaving(false);
            toast('success', 'Đã lưu ma trận quyền.');
            onSaved();
          }}
        />
      )}
    </div>
  );
}

/* Một hàng cờ hành động (cột = vai). Cờ khóa & vai chu_shop hiển thị read-only. */
function FlagRow({
  flag,
  locked,
  rows,
  edit,
  onToggle,
}: {
  flag: string;
  locked: boolean;
  rows: RoleMatrixRow[];
  edit: EditState;
  onToggle: (role: string, flag: string, val: boolean) => void;
}) {
  return (
    <tr>
      <td className={locked ? 'muted' : undefined}>
        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
          {locked && <Lock size={12} aria-hidden />}
          {flagLabelVi[flag] ?? flag}
        </span>
      </td>
      {rows.map((r) => {
        // Read-only khi: cờ khóa cứng, hoặc vai Chủ shop (locked).
        const readOnly = locked || r.locked;
        const checked = readOnly ? flagVal(r.flags, flag) : !!edit[r.role]?.flags[flag];
        return (
          <td key={r.role} style={{ textAlign: 'center' }}>
            <input
              type="checkbox"
              aria-label={`${flagLabelVi[flag] ?? flag} — ${roleVi[r.role]}`}
              checked={checked}
              disabled={readOnly}
              onChange={(e) => onToggle(r.role, flag, e.target.checked)}
            />
          </td>
        );
      })}
    </tr>
  );
}

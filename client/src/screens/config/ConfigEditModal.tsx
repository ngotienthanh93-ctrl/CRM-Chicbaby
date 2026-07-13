import { useEffect, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { ConfigAppliesTo, RecalcPreview, SystemConfigItem } from '../../api/types';
import { ReauthModal } from '../admin/ReauthModal';
import { fmtConfigValue, parseConfigInput, toInputString, valueKind } from './configFormat';

/**
 * 🔴 CFG-01..03: sửa một tham số cấu hình.
 * - Lý do BẮT BUỘC (disable Lưu nếu trống).
 * - appliesTo: new_only (mặc định) / recalculate.
 * - Chọn recalculate ⇒ gọi recalculate-preview, hiện PREVIEW (đổi/đóng/mất) TRƯỚC khi xác nhận.
 * - Lưu qua ReauthModal → PUT (AUTH-12).
 */
export function ConfigEditModal({
  item,
  onClose,
  onDone,
}: {
  item: SystemConfigItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const kind = valueKind(item.value);
  const [raw, setRaw] = useState<string>(() => toInputString(item.value));
  const [reason, setReason] = useState('');
  const [appliesTo, setAppliesTo] = useState<ConfigAppliesTo>('new_only');

  const parsed = parseConfigInput(raw, kind);
  const reasonOk = reason.trim().length > 0;

  // 🔴 PREVIEW ảnh hưởng — chỉ khi chọn recalculate và giá trị hợp lệ.
  const [preview, setPreview] = useState<RecalcPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // 🔴 CFG-02/03: khi chọn "tính lại việc cũ", CHẶN lưu tới khi xem trước ảnh hưởng THÀNH CÔNG.
  // Tránh áp recalculate mù (đang tính / preview lỗi / chưa có preview).
  const previewBlocked =
    appliesTo === 'recalculate' && (previewing || previewErr !== null || preview === null);
  const disabled = !parsed.ok || !reasonOk || previewBlocked;

  useEffect(() => {
    if (appliesTo !== 'recalculate' || !parsed.ok) {
      setPreview(null);
      setPreviewErr(null);
      setPreviewing(false);
      return;
    }
    let alive = true;
    setPreviewing(true);
    setPreviewErr(null);
    // 🔴 CWE-400: debounce 400ms — gõ nhanh KHÔNG bắn một loạt query preview (mỗi lần quét toàn bộ việc mở).
    // Giữ previewing=true suốt lúc chờ ⇒ nút Lưu vẫn khóa tới khi có kết quả (khớp guard recalculate).
    const timer = setTimeout(() => {
      api
        .post<RecalcPreview>('/api/config/recalculate-preview', { key: item.key, value: parsed.value })
        .then((p) => {
          if (alive) setPreview(p);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setPreview(null);
          setPreviewErr(e instanceof ApiError ? e.message : 'Không xem trước được ảnh hưởng.');
        })
        .finally(() => {
          if (alive) setPreviewing(false);
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // parsed.value là primitive; parsed.ok là boolean — an toàn làm deps.
  }, [appliesTo, parsed.ok, parsed.value, item.key]);

  return (
    <ReauthModal
      title={`Sửa tham số: ${item.key}`}
      submitLabel="Lưu thay đổi"
      disabled={disabled}
      warning={
        <div className="notice notice-neutral">
          <Info size={16} aria-hidden />
          <span className="small">
            Thay đổi tạo phiên bản mới (versioned) kèm lý do và được ghi nhật ký. Giá trị hiện tại:{' '}
            <strong>{fmtConfigValue(item.value)}</strong> (v{item.version}).
          </span>
        </div>
      }
      onClose={onClose}
      onSubmit={(password) =>
        api.put(`/api/config/${item.key}`, {
          value: parsed.value,
          reason: reason.trim(),
          appliesTo,
          password,
        })
      }
      onDone={onDone}
    >
      <div className="field">
        <label className="label" htmlFor="cfg-value">
          Giá trị mới
        </label>
        {kind === 'boolean' ? (
          <select
            id="cfg-value"
            className="select"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          >
            <option value="true">Có (bật)</option>
            <option value="false">Không (tắt)</option>
          </select>
        ) : (
          <input
            id="cfg-value"
            className="input"
            type={kind === 'number' ? 'number' : 'text'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoFocus
          />
        )}
        {!parsed.ok && (
          <span className="caption" style={{ color: 'var(--c-danger)' }}>
            {kind === 'number' ? 'Nhập một số hợp lệ.' : 'Giá trị không được để trống.'}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="cfg-reason">
          Lý do thay đổi <span className="req">*</span>
        </label>
        <input
          id="cfg-reason"
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Bắt buộc — ghi rõ vì sao đổi tham số này"
        />
      </div>

      <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend className="label">Phạm vi áp dụng</legend>
        <label className="row" style={{ gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
          <input
            type="radio"
            name="cfg-applies"
            checked={appliesTo === 'new_only'}
            onChange={() => setAppliesTo('new_only')}
          />
          <span className="small">
            <strong>Chỉ việc mới</strong> — không đụng việc đã tạo (mặc định, an toàn).
          </span>
        </label>
        <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input
            type="radio"
            name="cfg-applies"
            checked={appliesTo === 'recalculate'}
            onChange={() => setAppliesTo('recalculate')}
          />
          <span className="small">
            <strong>Tính lại việc cũ</strong> — áp cho cả việc đang mở (xem trước ảnh hưởng bên dưới).
          </span>
        </label>
      </fieldset>

      {appliesTo === 'recalculate' && (
        <PreviewPanel previewing={previewing} preview={preview} error={previewErr} />
      )}
    </ReauthModal>
  );
}

/** Bảng xem trước ảnh hưởng khi recalculate — số việc ĐỔI/ĐÓNG/MẤT + ghi chú trung thực. */
function PreviewPanel({
  previewing,
  preview,
  error,
}: {
  previewing: boolean;
  preview: RecalcPreview | null;
  error: string | null;
}) {
  if (previewing) {
    return (
      <div className="notice notice-neutral">
        <span className="small">Đang tính xem trước ảnh hưởng…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="notice notice-warning">
        <AlertTriangle size={16} aria-hidden />
        <span className="small">{error}</span>
      </div>
    );
  }
  if (!preview) return null;
  return (
    <div className="notice notice-warning" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} aria-hidden />
        <span className="small">
          <strong>Xem trước ảnh hưởng</strong> — việc đang mở bị tác động nếu áp dụng:
        </span>
      </div>
      <div className="row-wrap" style={{ gap: 16, marginTop: 8 }}>
        <PreviewStat label="Đổi ngày" value={preview.changed} />
        <PreviewStat label="Bị đóng" value={preview.closed} />
        <PreviewStat label="Bị mất" value={preview.lost} />
        <PreviewStat label="Tổng ảnh hưởng" value={preview.affected} />
      </div>
      <p className="caption" style={{ marginTop: 8 }}>
        {preview.note}
      </p>
      {!preview.estimated && (
        <p className="caption" style={{ marginTop: 4, fontWeight: 700 }}>
          ⚠️ Ước tính chưa chính xác — bản xem trước chưa lượng hóa hết; nhiều tham số chỉ áp dụng
          cho việc mới. Hãy kiểm tra lại danh sách việc sau khi áp.
        </p>
      )}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stack-2" style={{ gap: 2 }}>
      <span className="num" style={{ fontSize: 'var(--fs-h3)', fontWeight: 700 }}>
        {value}
      </span>
      <span className="caption">{label}</span>
    </div>
  );
}

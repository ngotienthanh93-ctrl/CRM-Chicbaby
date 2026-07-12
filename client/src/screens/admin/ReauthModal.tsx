import { useState, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';

/**
 * 🔴 AUTH-12: modal xác nhận + NHẬP LẠI MẬT KHẨU cho mọi thao tác nhạy cảm (SCR-13).
 * Modal tự quản lý field mật khẩu + trạng thái bận + báo lỗi; parent truyền các field phụ qua `children`
 * và tự kiểm tra hợp lệ qua `disabled`. `onSubmit(password)` NÉM lỗi nếu thất bại (để giữ modal mở).
 */
export function ReauthModal({
  title,
  warning,
  submitLabel = 'Xác nhận',
  danger = false,
  disabled = false,
  onClose,
  onSubmit,
  onDone,
  children,
}: {
  title: string;
  /** Cảnh báo hiển thị đầu modal (đã kèm icon nếu cần). */
  warning?: ReactNode;
  submitLabel?: string;
  danger?: boolean;
  /** Chặn gửi khi field phụ chưa hợp lệ (ngoài mật khẩu). */
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
  onDone: () => void;
  children?: ReactNode;
}) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(password);
      onDone();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Thao tác thất bại, kiểm tra mật khẩu.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={submit}
            disabled={!password || busy || disabled}
          >
            {busy ? 'Đang xử lý…' : submitLabel}
          </button>
        </>
      }
    >
      <div className="stack-4">
        {warning}
        {children}
        <div className="field">
          <label className="label" htmlFor="reauth-pw">
            Nhập lại mật khẩu để xác minh
          </label>
          <input
            id="reauth-pw"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>
      </div>
    </Modal>
  );
}

/** Cảnh báo dùng chung: đổi vai / khóa sẽ thu hồi phiên & thiết bị NGAY. */
export function RevokeWarning({ text }: { text: string }) {
  return (
    <div className="notice notice-warning">
      <ShieldAlert size={16} aria-hidden />
      <span className="small">{text}</span>
    </div>
  );
}

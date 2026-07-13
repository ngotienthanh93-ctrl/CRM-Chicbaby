import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  KeyRound,
  Copy,
  Download,
  Smartphone,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type {
  TrustedDevicesResponse,
  TwoFactorBackupCodesResult,
  TwoFactorSetup,
  TwoFactorStatus,
} from '../api/types';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import { ReauthModal, RevokeWarning } from './admin/ReauthModal';
import { fmtDateTime } from './admin/adminLabels';

/** Nhóm secret thành cụm 4 ký tự cho dễ đọc khi nhập tay (không đổi giá trị gốc). */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** Sao chép văn bản vào clipboard; báo toast thành công/thất bại. */
async function copyText(text: string, onDone: (ok: boolean) => void) {
  try {
    await navigator.clipboard.writeText(text);
    onDone(true);
  } catch {
    onDone(false);
  }
}

/** Tải chuỗi văn bản về máy dưới dạng .txt. */
function downloadTxt(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Render QR từ otpauth URI. Nếu tạo QR lỗi thì ẩn ảnh — secret dạng chữ vẫn là fallback. */
function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    QRCode.toDataURL(value, { width: 200, margin: 1 })
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value]);

  if (failed) return null;
  if (!src) return <div className="skeleton" style={{ width: 200, height: 200, borderRadius: 8 }} />;
  return (
    <img
      src={src}
      width={200}
      height={200}
      alt="Mã QR — quét bằng ứng dụng xác thực để thêm tài khoản"
      style={{ display: 'block', borderRadius: 8, border: '1px solid var(--c-border)' }}
    />
  );
}

/** Hiển thị danh sách mã dự phòng MỘT LẦN + nút sao chép / tải .txt. */
function BackupCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const toast = useToast();
  const text = codes.join('\n');

  return (
    <Modal
      title="Mã dự phòng"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Tôi đã lưu lại
        </button>
      }
    >
      <div className="stack-4">
        <div className="notice notice-warning">
          <ShieldAlert size={16} aria-hidden />
          <span className="small">
            Lưu các mã này ở nơi an toàn. Mỗi mã dùng được MỘT lần khi bạn không có ứng dụng xác
            thực. Danh sách này sẽ KHÔNG hiển thị lại.
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--sp-2)',
          }}
        >
          {codes.map((c) => (
            <code
              key={c}
              style={{
                fontFamily: 'var(--font-num)',
                fontSize: 15,
                letterSpacing: '0.06em',
                padding: '8px 10px',
                borderRadius: 'var(--r-control)',
                background: 'var(--c-neutral-weak)',
                border: '1px solid var(--c-border)',
                textAlign: 'center',
              }}
            >
              {c}
            </code>
          ))}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={() =>
              void copyText(text, (ok) =>
                ok
                  ? toast('success', 'Đã sao chép mã dự phòng.')
                  : toast('error', 'Không sao chép được, hãy chọn và copy thủ công.'),
              )
            }
          >
            <Copy size={15} aria-hidden />
            Sao chép
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => downloadTxt(text + '\n', 'chicbaby-ma-du-phong.txt')}
          >
            <Download size={15} aria-hidden />
            Tải .txt
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Bước 2 enroll: hiện QR + secret + hướng dẫn, nhập mã 6 số để bật 2FA. */
function EnrollVerifyModal({
  setup,
  onEnable,
  onClose,
}: {
  setup: TwoFactorSetup;
  /** NÉM ApiError nếu code sai (giữ modal mở). */
  onEnable: (code: string) => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await onEnable(code.trim());
      // Thành công: parent tháo modal này để hiện mã dự phòng.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mã không đúng, vui lòng thử lại.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Quét mã & xác nhận"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={!code.trim() || busy}
          >
            {busy ? 'Đang bật…' : 'Bật 2FA'}
          </button>
        </>
      }
    >
      <div className="stack-4">
        <p className="small muted">
          Quét mã QR bằng ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…). Nếu
          không quét được, nhập mã bí mật bên dưới vào ứng dụng theo cách thủ công.
        </p>

        <div style={{ display: 'grid', placeItems: 'center' }}>
          <QrImage value={setup.otpauthUri} />
        </div>

        <div className="field">
          <label className="label">Mã bí mật (nhập tay nếu không quét được)</label>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code
              style={{
                fontFamily: 'var(--font-num)',
                fontSize: 15,
                letterSpacing: '0.12em',
                padding: '8px 10px',
                borderRadius: 'var(--r-control)',
                background: 'var(--c-neutral-weak)',
                border: '1px solid var(--c-border)',
                wordBreak: 'break-all',
              }}
            >
              {groupSecret(setup.secret)}
            </code>
            <button
              className="btn btn-outline btn-sm"
              onClick={() =>
                void copyText(setup.secret, (ok) =>
                  ok
                    ? toast('success', 'Đã sao chép mã bí mật.')
                    : toast('error', 'Không sao chép được, hãy chọn và copy thủ công.'),
                )
              }
            >
              <Copy size={15} aria-hidden />
              Sao chép
            </button>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="enroll-code">
            Mã xác thực (6 số) từ ứng dụng
          </label>
          <input
            id="enroll-code"
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="••••••"
            autoFocus
          />
        </div>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Danh sách thiết bị tin cậy + thu hồi từng thiết bị. */
function TrustedDevicesSection({ refreshKey }: { refreshKey: number }) {
  const toast = useToast();
  const state = useApi<TrustedDevicesResponse>(
    () => api.get('/api/auth/2fa/trusted-devices'),
    [refreshKey],
  );
  const [revoking, setRevoking] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await api.post(`/api/auth/2fa/trusted-devices/${id}/revoke`);
      toast('success', 'Đã thu hồi thiết bị tin cậy.');
      state.reload();
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Không thu hồi được thiết bị.');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <section className="card card-pad stack-2">
      <h2 className="h3">Thiết bị tin cậy</h2>
      <p className="small muted">
        Thiết bị đã được ghi nhớ sẽ bỏ qua bước nhập mã 2FA trong thời hạn. Thu hồi nếu bạn không còn
        dùng thiết bị đó.
      </p>

      {state.status === 'loading' ? (
        <SkeletonCards count={2} />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={state.reload} />
      ) : state.data.items.length === 0 ? (
        <EmptyState
          icon={<Smartphone size={26} />}
          title="Chưa có thiết bị tin cậy"
          hint="Khi đăng nhập, tick “Tin thiết bị này” để ghi nhớ và bỏ qua 2FA trong thời hạn."
        />
      ) : (
        <div className="stack-2">
          {state.data.items.map((d) => (
            <div
              key={d.id}
              className="card card-pad between"
              style={{ flexWrap: 'wrap', gap: 8 }}
            >
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <Smartphone size={16} aria-hidden className="muted" />
                <div className="stack-2" style={{ gap: 2 }}>
                  <b>{d.deviceLabel ?? 'Thiết bị không tên'}</b>
                  <span className="caption">
                    Dùng cuối: {fmtDateTime(d.lastUsedAt)} · Ghi nhớ từ {fmtDateTime(d.createdAt)} ·
                    Hết hạn: {fmtDateTime(d.expiresAt)}
                  </span>
                </div>
              </div>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => void revoke(d.id)}
                disabled={revoking === d.id}
              >
                {revoking === d.id ? 'Đang thu hồi…' : 'Thu hồi'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Flow = 'setup' | 'verify' | 'regen' | 'disable' | null;

export function SecurityScreen() {
  const toast = useToast();
  const status = useApi<TwoFactorStatus>(() => api.get('/api/auth/2fa/status'), []);

  const [flow, setFlow] = useState<Flow>(null);
  const [setupData, setSetupData] = useState<TwoFactorSetup | null>(null);
  const [enrollPassword, setEnrollPassword] = useState('');
  const [shownCodes, setShownCodes] = useState<string[] | null>(null);
  // Bump để nạp lại danh sách thiết bị tin cậy (vd sau khi tắt 2FA thu hồi hết).
  const [devicesKey, setDevicesKey] = useState(0);

  const resetEnroll = () => {
    setFlow(null);
    setSetupData(null);
    setEnrollPassword('');
  };

  const closeCodes = () => {
    setShownCodes(null);
    resetEnroll();
    status.reload();
    setDevicesKey((k) => k + 1);
  };

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Bảo mật</h1>
          <p className="small muted">
            Bật xác thực 2 lớp (2FA) và quản lý thiết bị tin cậy cho tài khoản của bạn.
          </p>
        </div>
      </div>

      <div className="notice notice-neutral" style={{ marginBottom: 16 }}>
        <ShieldCheck size={16} aria-hidden />
        <span className="small">
          Xác thực 2 lớp thêm một lớp bảo vệ: ngoài mật khẩu, cần thêm mã đổi liên tục từ ứng dụng
          xác thực trên điện thoại của bạn.
        </span>
      </div>

      <div className="stack-4">
        {/* --- Thẻ 2FA --- */}
        {status.status === 'loading' ? (
          <SkeletonCards count={1} />
        ) : status.status === 'error' ? (
          <ErrorState error={status.error} onRetry={status.reload} />
        ) : (
          <section className="card card-pad stack-4">
            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <KeyRound size={18} aria-hidden className="muted" />
                <h2 className="h3">Xác thực 2 lớp (TOTP)</h2>
              </div>
              {status.data.enabled ? (
                <Badge tone="success">Đang bật</Badge>
              ) : (
                <Badge tone="neutral">Đang tắt</Badge>
              )}
            </div>

            {status.data.enabled ? (
              <>
                <div className="stack-2">
                  <div className="small">
                    Đã bật từ: <b>{fmtDateTime(status.data.enrolledAt)}</b>
                  </div>
                  <div className="small">
                    Mã dự phòng còn lại: <b>{status.data.backupCodesRemaining}</b>
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-outline" onClick={() => setFlow('regen')}>
                    <RefreshCw size={16} aria-hidden />
                    Phát lại mã dự phòng
                  </button>
                  <button className="btn btn-danger" onClick={() => setFlow('disable')}>
                    <ShieldOff size={16} aria-hidden />
                    Tắt 2FA
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="small muted">
                  Khi bật, mỗi lần đăng nhập bạn sẽ cần nhập thêm mã 6 số từ ứng dụng xác thực. Bạn
                  cũng nhận được các mã dự phòng để dùng khi không có điện thoại.
                </p>
                <div>
                  <button className="btn btn-primary" onClick={() => setFlow('setup')}>
                    <ShieldCheck size={16} aria-hidden />
                    Bật xác thực 2 lớp
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* --- Thiết bị tin cậy --- */}
        <TrustedDevicesSection refreshKey={devicesKey} />
      </div>

      {/* Bước 1 enroll: xác minh mật khẩu → /2fa/setup */}
      {flow === 'setup' && (
        <ReauthModal
          title="Bật xác thực 2 lớp"
          submitLabel="Tiếp tục"
          onClose={resetEnroll}
          onSubmit={async (password) => {
            const setup = await api.post<TwoFactorSetup>('/api/auth/2fa/setup', { password });
            setSetupData(setup);
            setEnrollPassword(password);
          }}
          onDone={() => setFlow('verify')}
        />
      )}

      {/* Bước 2 enroll: quét QR + nhập mã → /2fa/enable */}
      {flow === 'verify' && setupData && (
        <EnrollVerifyModal
          setup={setupData}
          onClose={resetEnroll}
          onEnable={async (code) => {
            const res = await api.post<TwoFactorBackupCodesResult>('/api/auth/2fa/enable', {
              password: enrollPassword,
              code,
            });
            // Đóng modal verify, hiện mã dự phòng MỘT LẦN.
            setFlow(null);
            setShownCodes(res.backupCodes);
            toast('success', 'Đã bật xác thực 2 lớp.');
          }}
        />
      )}

      {/* Phát lại mã dự phòng: xác minh mật khẩu → /2fa/backup-codes */}
      {flow === 'regen' && (
        <ReauthModal
          title="Phát lại mã dự phòng"
          submitLabel="Phát lại"
          warning={
            <div className="notice notice-warning">
              <ShieldAlert size={16} aria-hidden />
              <span className="small">
                Phát lại sẽ thay thế toàn bộ mã dự phòng cũ. Các mã cũ sẽ ngừng hoạt động.
              </span>
            </div>
          }
          onClose={() => setFlow(null)}
          onSubmit={async (password) => {
            const res = await api.post<TwoFactorBackupCodesResult>(
              '/api/auth/2fa/backup-codes',
              { password },
            );
            setShownCodes(res.backupCodes);
          }}
          onDone={() => setFlow(null)}
        />
      )}

      {/* Tắt 2FA: xác minh mật khẩu → /2fa/disable */}
      {flow === 'disable' && (
        <ReauthModal
          title="Tắt xác thực 2 lớp"
          submitLabel="Tắt 2FA"
          danger
          warning={
            <RevokeWarning text="Tắt 2FA sẽ thu hồi mọi thiết bị tin cậy và làm mất hiệu lực các mã dự phòng hiện có." />
          }
          onClose={() => setFlow(null)}
          onSubmit={(password) => api.post('/api/auth/2fa/disable', { password })}
          onDone={() => {
            setFlow(null);
            toast('success', 'Đã tắt xác thực 2 lớp.');
            status.reload();
            setDevicesKey((k) => k + 1);
          }}
        />
      )}

      {/* Hiện mã dự phòng (dùng chung cho enroll & phát lại) */}
      {shownCodes && <BackupCodesModal codes={shownCodes} onClose={closeCodes} />}
    </div>
  );
}

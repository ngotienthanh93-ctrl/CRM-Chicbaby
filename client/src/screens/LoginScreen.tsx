import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Baby as BabyIcon, LogIn, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from '../app/AuthContext';
import { ApiError } from '../api/client';

type Step = 'password' | 'twofa';

export function LoginScreen() {
  const { login, completeTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false); // 🔴 KHÔNG tick sẵn
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Bước 2: xác thực 2 lớp.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false); // đổi ô nhập TOTP <-> mã dự phòng

  const goToDefault = () => navigate('/viec-hom-nay', { replace: true });

  const onSubmitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await login(username.trim(), password, remember);
      if (outcome.twoFactorRequired) {
        // Cần bước 2: chuyển màn nhập mã, KHÔNG điều hướng.
        setChallenge(outcome.challenge);
        setStep('twofa');
        setCode('');
        setTrustDevice(false);
        setUseBackupCode(false);
      } else {
        goToDefault();
      }
    } catch (err) {
      // AUTH-10: thông điệp KHÔNG tiết lộ tài khoản có tồn tại hay không.
      const msg =
        err instanceof ApiError && err.status === 401
          ? 'Tên đăng nhập hoặc mật khẩu không đúng.'
          : err instanceof ApiError
            ? err.message
            : 'Không đăng nhập được, vui lòng thử lại.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitTwoFactor = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setSubmitting(true);
    try {
      await completeTwoFactor(challenge, code.trim(), trustDevice, remember);
      goToDefault();
    } catch (err) {
      // Sai mã / challenge hết hạn => 401 kèm message từ server.
      const msg =
        err instanceof ApiError ? err.message : 'Xác thực không thành công, vui lòng thử lại.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const backToPassword = () => {
    setStep('password');
    setChallenge(null);
    setCode('');
    setError(null);
    setUseBackupCode(false);
  };

  return (
    <div className="login-page">
      {step === 'password' ? (
        <form className="login-card card" onSubmit={onSubmitPassword}>
          <div className="login-brand">
            <span className="brand-mark" aria-hidden>
              <BabyIcon size={22} />
            </span>
            <div>
              <div className="h2">CRM Chicbaby</div>
              <div className="small muted">Hôm nay tôi gọi ai, nói gì?</div>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="username">
              Tên đăng nhập
            </label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="password">
              Mật khẩu
            </label>
            <div className="input-with-btn">
              <input
                id="password"
                className="input"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPw ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Ghi nhớ đăng nhập</span>
          </label>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={submitting}>
            <LogIn size={18} aria-hidden />
            {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>

          <p className="caption login-hint">
            Dữ liệu minh họa. Tài khoản thử: chushop · crm · cskh · marketing · trolydulieu (mật khẩu
            chung do chủ shop cấp).
          </p>
        </form>
      ) : (
        <form className="login-card card" onSubmit={onSubmitTwoFactor}>
          <div className="login-brand">
            <span className="brand-mark" aria-hidden>
              <ShieldCheck size={22} />
            </span>
            <div>
              <div className="h2">Xác thực 2 lớp</div>
              <div className="small muted">
                {useBackupCode
                  ? 'Nhập một mã dự phòng bạn đã lưu.'
                  : 'Nhập mã 6 số từ ứng dụng xác thực của bạn.'}
              </div>
            </div>
          </div>

          <div className="field">
            <label className="label" htmlFor="twofa-code">
              {useBackupCode ? 'Mã dự phòng' : 'Mã xác thực (6 số)'}
            </label>
            <input
              id="twofa-code"
              className="input"
              // TOTP: bàn phím số + gợi ý OTP; mã dự phòng có chữ nên để text thường.
              inputMode={useBackupCode ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={useBackupCode ? 'VD: A1B2-C3D4' : '••••••'}
              autoFocus
              required
            />
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
            />
            <span>Tin thiết bị này (bỏ qua 2FA trong thời hạn)</span>
          </label>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setUseBackupCode((v) => !v);
              setCode('');
              setError(null);
            }}
          >
            {useBackupCode ? 'Dùng mã 6 số từ ứng dụng' : 'Dùng mã dự phòng'}
          </button>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={submitting}>
            <ShieldCheck size={18} aria-hidden />
            {submitting ? 'Đang xác thực…' : 'Xác nhận'}
          </button>

          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={backToPassword}
            disabled={submitting}
          >
            <ArrowLeft size={16} aria-hidden />
            Quay lại
          </button>
        </form>
      )}
    </div>
  );
}

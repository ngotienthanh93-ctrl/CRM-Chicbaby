import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Baby as BabyIcon, LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../app/AuthContext';
import { ApiError } from '../api/client';

export function LoginScreen() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false); // 🔴 KHÔNG tick sẵn
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password, remember);
      navigate('/viec-hom-nay', { replace: true });
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

  return (
    <div className="login-page">
      <form className="login-card card" onSubmit={onSubmit}>
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
    </div>
  );
}

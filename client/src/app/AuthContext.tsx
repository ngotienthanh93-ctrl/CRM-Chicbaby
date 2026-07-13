import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { AuthUser, LoginResponse, MeResponse, Permissions } from '../api/types';

interface AuthState {
  loading: boolean;
  user: AuthUser | null;
  permissions: Permissions | null;
}

/**
 * Kết quả bước 1 đăng nhập: nếu `twoFactorRequired` => CHƯA đăng nhập, LoginScreen phải
 * chuyển sang bước nhập mã 2FA với `challenge`. Ngược lại đã đăng nhập xong.
 */
export type LoginOutcome =
  | { twoFactorRequired: false }
  | { twoFactorRequired: true; challenge: string };

interface AuthContextValue extends AuthState {
  login: (username: string, password: string, remember: boolean) => Promise<LoginOutcome>;
  /** Bước 2 đăng nhập: gửi mã TOTP hoặc mã dự phòng theo `challenge`, rồi nạp lại phiên. */
  completeTwoFactor: (
    challenge: string,
    code: string,
    trustDevice: boolean,
    remember: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, user: null, permissions: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/api/auth/me');
      setState({ loading: false, user: me.user, permissions: me.permissions });
    } catch (err) {
      // 401 => chưa đăng nhập; các lỗi khác cũng coi như chưa đăng nhập (an toàn).
      if (!(err instanceof ApiError)) throw err;
      setState({ loading: false, user: null, permissions: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string, remember: boolean): Promise<LoginOutcome> => {
      const res = await api.post<LoginResponse>('/api/auth/login', { username, password, remember });
      if ('twoFactorRequired' in res) {
        // Bật 2FA: KHÔNG set user — trả challenge để LoginScreen sang bước nhập mã.
        return { twoFactorRequired: true, challenge: res.challenge };
      }
      setState({ loading: false, user: res.user, permissions: res.permissions });
      return { twoFactorRequired: false };
    },
    [],
  );

  const completeTwoFactor = useCallback(
    async (challenge: string, code: string, trustDevice: boolean, remember: boolean) => {
      await api.post('/api/auth/login/2fa', { challenge, code, trustDevice, remember });
      // Backend đã đặt cookie phiên — nạp lại user/permissions từ /me.
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setState({ loading: false, user: null, permissions: null });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, completeTwoFactor, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>');
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { AuthUser, MeResponse, Permissions } from '../api/types';

interface AuthState {
  loading: boolean;
  user: AuthUser | null;
  permissions: Permissions | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string, remember: boolean) => Promise<void>;
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

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const res = await api.post<MeResponse>('/api/auth/login', { username, password, remember });
    setState({ loading: false, user: res.user, permissions: res.permissions });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setState({ loading: false, user: null, permissions: null });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải nằm trong <AuthProvider>');
  return ctx;
}

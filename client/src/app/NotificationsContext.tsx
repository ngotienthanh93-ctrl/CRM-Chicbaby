import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { UnreadCountResponse } from '../api/types';
import { useAuth } from './AuthContext';

/** Chu kỳ poll số chưa đọc (ms) — 45s, đủ tươi mà không spam server. */
const POLL_MS = 45_000;

interface NotificationsContextValue {
  unreadCount: number;
  /** Nạp lại số chưa đọc ngay (VD sau khi đánh dấu đã đọc). */
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/**
 * Cung cấp số hoạt động chưa đọc cho chuông topbar + màn Thông báo.
 * CHỈ poll khi vai là chu_shop (server cũng 403 với vai khác). Lỗi được nuốt im lặng —
 * chuông không được làm vỡ app.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { permissions } = useAuth();
  const isOwner = permissions?.role === 'chu_shop';
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isOwner) return;
    try {
      const r = await api.get<UnreadCountResponse>('/api/notifications/unread-count');
      setUnreadCount(r.unreadCount);
    } catch {
      // im lặng: chuông chỉ là phụ trợ, không chặn luồng chính.
    }
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner) {
      setUnreadCount(0);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [isOwner, refresh]);

  return (
    <NotificationsContext.Provider value={{ unreadCount, refresh }}>
      {children}
    </NotificationsContext.Provider>
  );
}

/** An toàn khi không có provider (vai khác) — trả 0 + no-op. */
export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) return { unreadCount: 0, refresh: () => {} };
  return ctx;
}

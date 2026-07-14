import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import type { FollowUpEvidence, NotificationItem, NotificationsResponse } from '../api/types';
import { SkeletonCards, EmptyState, ErrorState } from '../components/ui';
import { Modal } from '../components/Modal';
import { EvidenceGallery } from '../components/EvidenceGallery';
import { useNotifications } from '../app/NotificationsContext';

/** Giờ Việt Nam (Asia/Ho_Chi_Minh) — dữ liệu createdAt lưu UTC. */
const dtf = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dtf.format(d);
}

export function NotificationsScreen() {
  const state = useApi<NotificationsResponse>(() => api.get('/api/notifications'), []);
  const { refresh } = useNotifications();
  const [marking, setMarking] = useState(false);
  // Việc đang mở modal xem ảnh bằng chứng (null = đóng). Giữ cả item để hiện tên trong tiêu đề.
  const [openItem, setOpenItem] = useState<NotificationItem | null>(null);

  const markRead = useCallback(async () => {
    setMarking(true);
    try {
      // Gửi watermark `asOf` (mốc lúc màn tải danh sách) => hoạt động đến SAU đó vẫn giữ unread.
      const readUntil = state.status === 'success' ? state.data.asOf : undefined;
      await api.post('/api/notifications/read', readUntil ? { readUntil } : undefined);
      state.reload();
      refresh();
    } finally {
      setMarking(false);
    }
  }, [state, refresh]);

  const hasUnread =
    state.status === 'success' ? state.data.items.some((i) => i.isUnread) : false;

  return (
    <div className="stack">
      <div className="between">
        <div className="stack-2">
          <h1 className="h2">Thông báo</h1>
          <span className="small">Nhật ký làm việc của nhân viên — cập nhật định kỳ.</span>
        </div>
        <button className="btn btn-outline btn-sm" onClick={markRead} disabled={marking || !hasUnread}>
          <Check size={15} aria-hidden />
          <span>Đánh dấu đã đọc</span>
        </button>
      </div>

      {state.status === 'loading' && <SkeletonCards count={6} />}

      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}

      {state.status === 'success' && state.data.items.length === 0 && (
        <EmptyState
          icon={<Bell size={26} />}
          title="Chưa có hoạt động nào"
          hint="Khi nhân viên xử lý việc, ghi tư vấn, cập nhật khách/đại lý… sẽ hiện ở đây."
        />
      )}

      {state.status === 'success' && state.data.items.length > 0 && (
        <div className="stack-2">
          {state.data.items.map((it) => (
            <NotifRow key={it.id} item={it} onOpen={() => setOpenItem(it)} />
          ))}
        </div>
      )}

      {openItem && (
        <Modal
          title={`Ảnh bằng chứng · ${openItem.targetName ?? 'Việc cần làm'}`}
          onClose={() => setOpenItem(null)}
        >
          <EvidenceModalBody followUpId={openItem.followUpId} />
        </Modal>
      )}
    </div>
  );
}

/** Một dòng thông báo. Bấm được (button) khi có ảnh bằng chứng; nếu không thì là div tĩnh. */
function NotifRow({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const clickable = item.attachmentCount > 0 && item.followUpId != null;
  const inner = (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <div>
        <strong>{item.actorName}</strong> {item.summary}
        {item.targetName && (
          <>
            {' · '}
            <span className="notif-target">{item.targetName}</span>
          </>
        )}
        {clickable && (
          <span className="notif-evidence small">
            <ImageIcon size={13} aria-hidden />
            {item.attachmentCount} ảnh
          </span>
        )}
      </div>
      <span className="row notif-when small" style={{ gap: 4, alignItems: 'center' }}>
        {fmtWhen(item.createdAt)}
        {clickable && <ChevronRight size={15} aria-hidden />}
      </span>
    </div>
  );

  if (!clickable) {
    return (
      <div className={`card card-pad notif-item${item.isUnread ? ' unread' : ''}`}>{inner}</div>
    );
  }
  return (
    <button
      type="button"
      className={`card card-pad notif-item clickable${item.isUnread ? ' unread' : ''}`}
      onClick={onOpen}
      aria-label={`Xem ${item.attachmentCount} ảnh bằng chứng của ${item.targetName ?? 'việc cần làm'}`}
    >
      {inner}
    </button>
  );
}

/** Nội dung modal: tải ảnh bằng chứng của việc rồi hiển thị (chỉ xem). */
function EvidenceModalBody({ followUpId }: { followUpId: string | null }) {
  const [items, setItems] = useState<FollowUpEvidence[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!followUpId) return;
    let alive = true;
    setItems(null);
    setError(false);
    api
      .get<{ items: FollowUpEvidence[] }>(`/api/followups/${followUpId}/attachments`)
      .then((r) => {
        if (alive) setItems(r.items);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [followUpId]);

  if (error) return <p className="small muted">Không tải được ảnh bằng chứng.</p>;
  return <EvidenceGallery items={items} canDelete={false} />;
}

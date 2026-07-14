import { Trash2 } from 'lucide-react';
import type { FollowUpEvidence } from '../api/types';

/**
 * Xem lại các ảnh bằng chứng đã lưu của một việc. Read-only mặc định;
 * nút xóa CHỈ hiện khi có cả `canDelete` và `onDelete` (chu_shop ở màn xử lý việc).
 * Dùng chung giữa WorkActionSheet (xem + xóa) và màn Thông báo (chỉ xem).
 */
export function EvidenceGallery({
  items,
  canDelete = false,
  busy = false,
  onDelete,
}: {
  items: FollowUpEvidence[] | null;
  canDelete?: boolean;
  busy?: boolean;
  onDelete?: (attId: string) => void;
}) {
  if (items === null) return <p className="small muted">Đang tải ảnh bằng chứng…</p>;
  if (items.length === 0)
    return <p className="small muted">Chưa có ảnh bằng chứng nào cho việc này.</p>;
  return (
    <div className="stack-2">
      {items.map((a) => (
        <div key={a.id} className="card card-pad stack-2">
          <div className="between">
            <span className="small">
              {a.uploadedByName ?? 'Không rõ'} · {a.createdAt}
            </span>
            {canDelete && onDelete && (
              <button
                className="btn btn-ghost btn-icon"
                aria-label="Xóa ảnh bằng chứng"
                onClick={() => onDelete(a.id)}
                disabled={busy}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            )}
          </div>
          <a href={a.url} target="_blank" rel="noopener noreferrer">
            <img
              src={a.url}
              alt={a.caption ?? 'Ảnh bằng chứng'}
              style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }}
            />
          </a>
          {a.caption && <p className="small muted wrap-anywhere">{a.caption}</p>}
        </div>
      ))}
    </div>
  );
}

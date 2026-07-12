import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Clock,
  Info,
  Inbox,
  Lock,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type { Tone } from '../lib/labels';
import { ApiError } from '../api/client';

// Icon theo tông màu — đảm bảo trạng thái = MÀU + ICON + CHỮ (không chỉ màu).
const TONE_ICON: Record<Tone, typeof Info> = {
  neutral: Info,
  primary: Info,
  danger: ShieldAlert,
  warning: AlertTriangle,
  attention: Clock,
  success: CheckCircle2,
};

export function Badge({
  tone = 'neutral',
  children,
  icon = true,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: boolean;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={`badge badge-${tone}`}>
      {icon && <Icon size={13} aria-hidden />}
      {children}
    </span>
  );
}

export function KvBadge() {
  return (
    <span className="kv-badge" title="Dữ liệu nguồn KiotViet — chỉ đọc">
      <Lock size={11} aria-hidden />
      KV · chỉ đọc
    </span>
  );
}

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <AlertTriangle size={15} aria-hidden />
      <span>Dữ liệu minh họa — không phải dữ liệu khách hàng thật.</span>
    </div>
  );
}

export function Skeleton({ w, h = 14, r }: { w?: number | string; h?: number | string; r?: number }) {
  return (
    <span
      className="skeleton"
      style={{
        display: 'block',
        width: w ?? '100%',
        height: h,
        borderRadius: r,
      }}
      aria-hidden
    />
  );
}

/** Skeleton nhiều thẻ (không dùng spinner giữa màn trắng). */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card card-pad stack-2">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <Skeleton w={140} h={16} />
            <Skeleton w={80} h={20} r={999} />
          </div>
          <Skeleton w="70%" h={13} />
          <Skeleton w="90%" h={13} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card card-pad" aria-busy="true" aria-label="Đang tải">
      <div className="stack-2">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="row" style={{ gap: 16 }}>
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} h={14} w={c === 0 ? 180 : 90} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="state">
      <span className="state-icon">{icon ?? <Inbox size={26} aria-hidden />}</span>
      <div className="state-title">{title}</div>
      {hint && <div className="small">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  // KHÔNG lộ lỗi kỹ thuật — dùng message tiếng Việt đã chuẩn hóa ở api client.
  const msg = error instanceof ApiError ? error.message : 'Có lỗi xảy ra, vui lòng thử lại.';
  return (
    <div className="state state-error">
      <span className="state-icon">
        <CircleAlert size={26} aria-hidden />
      </span>
      <div className="state-title">Không tải được dữ liệu</div>
      <div className="small">{msg}</div>
      {onRetry && (
        <button className="btn btn-outline" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden />
          Thử lại
        </button>
      )}
    </div>
  );
}

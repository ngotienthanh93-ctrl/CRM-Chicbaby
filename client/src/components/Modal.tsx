import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

function useEscToClose(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEscToClose(onClose);
  return createPortal(
    <div className="overlay" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="h3">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Đóng">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Bottom-sheet cho hành động phụ trên mobile. */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscToClose(onClose);
  return createPortal(
    <div className="sheet-overlay" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <div className="between" style={{ marginBottom: 8 }}>
          <h2 className="h3">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Đóng">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

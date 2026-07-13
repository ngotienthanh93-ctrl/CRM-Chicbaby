import { RotateCcw } from 'lucide-react';
import { api } from '../../api/client';
import type { ConfigHistoryResponse, SystemConfigItem } from '../../api/types';
import { useApi } from '../../hooks/useApi';
import { Badge, EmptyState, ErrorState, SkeletonTable } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { fmtDateTime } from '../admin/adminLabels';
import { fmtConfigValue } from './configFormat';

const APPLIES_TO_VI: Record<string, string> = {
  new_only: 'Chỉ việc mới',
  recalculate: 'Tính lại việc cũ',
};

/**
 * 🔴 CFG-04: lịch sử phiên bản của một tham số + nút Rollback.
 * Rollback CHỈ đưa THAM SỐ về bản trước — việc đã tính lại KHÔNG tự hoàn tác (cảnh báo ở modal rollback).
 */
export function ConfigHistoryModal({
  item,
  onClose,
  onRollback,
}: {
  item: SystemConfigItem;
  onClose: () => void;
  onRollback: (toVersion: number) => void;
}) {
  const state = useApi<ConfigHistoryResponse>(
    () => api.get(`/api/config/${item.key}/history`),
    [item.key],
  );

  return (
    <Modal title={`Lịch sử tham số: ${item.key}`} onClose={onClose}>
      {state.status === 'loading' && <SkeletonTable rows={4} cols={5} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState title="Chưa có lịch sử thay đổi" />
        ) : (
          <div className="list-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Phiên bản</th>
                  <th>Giá trị</th>
                  <th>Phạm vi</th>
                  <th>Người đổi</th>
                  <th>Thời điểm</th>
                  <th>Lý do</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((h) => (
                  <tr key={h.version}>
                    <td className="num">
                      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                        v{h.version}
                        {h.isActive && <Badge tone="success">Hiện hành</Badge>}
                      </span>
                    </td>
                    <td className="num">{fmtConfigValue(h.value)}</td>
                    <td className="small">{h.appliesTo ? APPLIES_TO_VI[h.appliesTo] : '—'}</td>
                    <td className="small wrap-anywhere">
                      {h.changedBy?.fullName ?? h.createdBy?.fullName ?? '—'}
                    </td>
                    <td className="num">{fmtDateTime(h.changedAt)}</td>
                    <td className="small wrap-anywhere">{h.reason ?? '—'}</td>
                    <td>
                      {!h.isActive && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => onRollback(h.version)}
                        >
                          <RotateCcw size={14} aria-hidden />
                          Rollback về v{h.version}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </Modal>
  );
}

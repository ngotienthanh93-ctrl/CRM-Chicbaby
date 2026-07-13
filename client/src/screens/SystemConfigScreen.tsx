import { useMemo, useState } from 'react';
import { Pencil, History, Lock, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import type { SystemConfigItem, SystemConfigResponse } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorState, SkeletonTable } from '../components/ui';
import { ReauthModal } from './admin/ReauthModal';
import { ConfigEditModal } from './config/ConfigEditModal';
import { ConfigHistoryModal } from './config/ConfigHistoryModal';
import { fmtConfigValue, isScalarConfigValue } from './config/configFormat';

type ModalState =
  | { kind: 'edit'; item: SystemConfigItem }
  | { kind: 'history'; item: SystemConfigItem }
  | { kind: 'rollback'; item: SystemConfigItem; toVersion: number }
  | null;

const UNGROUPED_LABEL = 'Khác';

export function SystemConfigScreen() {
  const toast = useToast();
  const state = useApi<SystemConfigResponse>(() => api.get('/api/config'), []);
  const [modal, setModal] = useState<ModalState>(null);

  // Gộp tham số theo nhóm (groupLabel); null ⇒ nhóm "Khác". Giữ thứ tự xuất hiện.
  const groups = useMemo(() => {
    if (state.status !== 'success') return [];
    const map = new Map<string, SystemConfigItem[]>();
    for (const item of state.data.items) {
      const label = item.groupLabel ?? UNGROUPED_LABEL;
      const list = map.get(label);
      if (list) list.push(item);
      else map.set(label, [item]);
    }
    return [...map.entries()];
  }, [state]);

  const closeAndReload = (msg: string) => {
    setModal(null);
    toast('success', msg);
    state.reload();
  };

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Cấu hình hệ thống</h1>
          <p className="small muted">
            Tham số nghiệp vụ theo nhóm (Phụ lục B). Mỗi thay đổi bắt buộc ghi lý do, được version hóa
            và ghi nhật ký; thao tác yêu cầu nhập lại mật khẩu.
          </p>
        </div>
      </div>

      <div className="notice notice-neutral" style={{ marginBottom: 16 }}>
        <ShieldAlert size={16} aria-hidden />
        <span className="small">
          Tham số khóa cứng (vd trần việc chăm sóc = ∞) không sửa được — bảo vệ luật nghiệp vụ. Bảo
          mật thực thi ở máy chủ (403 nếu không đủ quyền).
        </span>
      </div>

      {state.status === 'loading' && <SkeletonTable rows={8} cols={4} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState title="Chưa có tham số cấu hình" />
        ) : (
          <div className="stack-4">
            {groups.map(([label, items]) => (
              <section key={label} className="card card-pad stack-2">
                <h3 className="h3">{label}</h3>
                <div className="list-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Tham số</th>
                        <th>Giá trị</th>
                        <th>Phiên bản</th>
                        <th>Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        // Sửa được khi: không khóa cứng VÀ giá trị là scalar (PUT chỉ nhận scalar).
                        const editable = !item.locked && isScalarConfigValue(item.value);
                        return (
                          <tr key={item.key}>
                            <td className="num wrap-anywhere">{item.key}</td>
                            <td className="num">
                              {item.locked ? (
                                <Badge tone="neutral" icon={false}>
                                  <Lock size={12} aria-hidden /> ∞ khóa cứng
                                </Badge>
                              ) : (
                                fmtConfigValue(item.value)
                              )}
                            </td>
                            <td className="num">v{item.version}</td>
                            <td>
                              {item.locked ? (
                                <span className="caption">Không sửa được</span>
                              ) : (
                                <div className="row-wrap" style={{ gap: 6 }}>
                                  {editable && (
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => setModal({ kind: 'edit', item })}
                                    >
                                      <Pencil size={14} aria-hidden />
                                      Sửa
                                    </button>
                                  )}
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setModal({ kind: 'history', item })}
                                  >
                                    <History size={14} aria-hidden />
                                    Lịch sử
                                  </button>
                                  {!editable && (
                                    <span className="caption">Giá trị phức tạp — không sửa tại đây</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        ))}

      {modal?.kind === 'edit' && (
        <ConfigEditModal
          item={modal.item}
          onClose={() => setModal(null)}
          onDone={() => closeAndReload('Đã lưu tham số cấu hình.')}
        />
      )}
      {modal?.kind === 'history' && (
        <ConfigHistoryModal
          item={modal.item}
          onClose={() => setModal(null)}
          onRollback={(toVersion) => setModal({ kind: 'rollback', item: modal.item, toVersion })}
        />
      )}
      {modal?.kind === 'rollback' && (
        <RollbackModal
          item={modal.item}
          toVersion={modal.toVersion}
          onClose={() => setModal(null)}
          onDone={() => closeAndReload(`Đã rollback tham số về v${modal.toVersion}.`)}
        />
      )}
    </div>
  );
}

/** 🔴 CFG-04: rollback tham số về phiên bản đích (lý do bắt buộc + reauth). */
function RollbackModal({
  item,
  toVersion,
  onClose,
  onDone,
}: {
  item: SystemConfigItem;
  toVersion: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <ReauthModal
      title={`Rollback ${item.key} về v${toVersion}`}
      submitLabel={`Rollback về v${toVersion}`}
      danger
      disabled={reason.trim().length === 0}
      warning={
        <div className="notice notice-warning">
          <ShieldAlert size={16} aria-hidden />
          <span className="small">
            Rollback CHỈ đưa <strong>tham số</strong> về bản trước (tạo phiên bản mới). Việc đã tính
            lại <strong>KHÔNG tự hoàn tác</strong> — hãy kiểm tra lại danh sách việc sau rollback.
          </span>
        </div>
      }
      onClose={onClose}
      onSubmit={(password) =>
        api.post(`/api/config/${item.key}/rollback`, {
          toVersion,
          reason: reason.trim(),
          password,
        })
      }
      onDone={onDone}
    >
      <div className="field">
        <label className="label" htmlFor="rb-reason">
          Lý do rollback <span className="req">*</span>
        </label>
        <input
          id="rb-reason"
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Bắt buộc — vì sao đưa tham số về bản cũ"
          autoFocus
        />
      </div>
    </ReauthModal>
  );
}

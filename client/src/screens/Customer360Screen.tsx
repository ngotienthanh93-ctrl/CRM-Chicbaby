import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Phone,
  Eye,
  ShieldCheck,
  Plus,
  Pencil,
  MessageSquarePlus,
  Facebook,
  MessageCircle,
  ExternalLink,
  Check,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type {
  Consultation,
  ConsentEvent,
  CustomerDetail,
  FollowUpAttachmentBrief,
  PurchasesResponse,
} from '../api/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, EmptyState, ErrorState, KvBadge, SkeletonCards } from '../components/ui';
import {
  assignmentStatusVi,
  consentStatusVi,
  consentTypeVi,
  consultationResultTone,
  consultationResultVi,
  invoiceStatusVi,
  reminderTypeVi,
  temperatureTone,
  temperatureVi,
  vnd,
} from '../lib/labels';
import { BabyTab } from './customer/BabyTab';
import { ConsultationModal } from './consultation/ConsultationModal';

type TabKey = 'info' | 'babies' | 'consultations' | 'purchases' | 'care' | 'consent';

export function Customer360Screen() {
  const { id = '' } = useParams();
  const { permissions } = useAuth();
  const [tab, setTab] = useState<TabKey>('info');

  const state = useApi<CustomerDetail>(() => api.get<CustomerDetail>(`/api/customers/${id}`), [id]);

  const canBaby = permissions?.viewBaby ?? false;
  const canConsult = permissions?.viewConsultation ?? false;

  const tabs: { key: TabKey; label: string; show: boolean }[] = [
    { key: 'info', label: 'Thông tin', show: true },
    { key: 'babies', label: `Hồ sơ bé${state.status === 'success' ? ` (${state.data.babyCount})` : ''}`, show: canBaby },
    { key: 'consultations', label: 'Tư vấn', show: canConsult },
    { key: 'purchases', label: 'Lịch sử mua', show: true },
    { key: 'care', label: 'Chăm sóc', show: true },
    { key: 'consent', label: 'Consent', show: true },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : 'info';

  return (
    <div>
      <Link to="/khach" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }}>
        <ArrowLeft size={16} aria-hidden />
        Danh sách khách
      </Link>

      {state.status === 'loading' && <SkeletonCards count={3} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' && (
        <>
          <CustomerHeader detail={state.data} />

          <div className="tabs" role="tablist">
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                className="tab"
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="tab-panel">
            {activeTab === 'info' && <InfoTab detail={state.data} onSaved={state.reload} />}
            {activeTab === 'babies' && canBaby && <BabyTab customerId={id} />}
            {activeTab === 'consultations' && canConsult && <ConsultationsTab customerId={id} />}
            {activeTab === 'purchases' && <PurchasesTab customerId={id} />}
            {activeTab === 'care' && <CareTab customerId={id} />}
            {activeTab === 'consent' && <ConsentTab customerId={id} />}
          </div>
        </>
      )}
    </div>
  );
}

function CustomerHeader({ detail }: { detail: CustomerDetail }) {
  const { permissions } = useAuth();
  const toast = useToast();
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const primary = detail.phones.find((p) => p.isPrimary) ?? detail.phones[0];

  const reveal = async () => {
    try {
      const res = await api.post<{ phones: { id: string; type: string; phone: string }[] }>(
        `/api/customers/${detail.id}/reveal-phone`,
      );
      const map: Record<string, string> = {};
      res.phones.forEach((p) => (map[p.id] = p.phone));
      setRevealed(map);
      toast('info', 'Đã ghi nhật ký truy cập số điện thoại đầy đủ.');
    } catch {
      toast('error', 'Không xem được số đầy đủ.');
    }
  };

  const phoneText = (id: string, masked: string | null) => revealed[id] ?? masked ?? '—';

  const initial = detail.displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="card detail-head">
      <div className="detail-head-top">
        <span className="detail-avatar" aria-hidden>
          {initial}
        </span>
        <div className="grow stack-2" style={{ gap: 6 }}>
          <div className="chip-row">
            <span className="detail-title">{detail.displayName}</span>
            <Badge
              tone={detail.roles.includes('wholesale_contact') ? 'primary' : 'neutral'}
              icon={false}
            >
              {roleLabel(detail.roles)}
            </Badge>
          </div>
          {primary && (
            <span className="phone-chip">
              <Phone size={15} aria-hidden />
              {phoneText(primary.id, primary.phone)}
            </span>
          )}
          <div className="chip-row" style={{ gap: 6 }}>
            {detail.kvCodes.length > 0 ? (
              detail.kvCodes.map((code) => (
                <span key={code} className="kv-badge">
                  {code}
                </span>
              ))
            ) : (
              <span className="small muted">Chưa liên kết mã KiotViet (CRM only)</span>
            )}
          </div>
        </div>
        {detail.masked && permissions?.viewSensitive && (
          <button className="btn btn-primary" onClick={reveal}>
            <Eye size={16} aria-hidden />
            Xem đầy đủ
          </button>
        )}
      </div>

      {detail.consents.length > 0 && (
        <div className="consent-strip">
          <ShieldCheck size={15} aria-hidden />
          <span className="consent-strip-label">Consent:</span>
          {dedupeConsents(detail.consents).map((c) => (
            <Badge key={c.type} tone={c.status === 'granted' ? 'success' : 'neutral'} icon={false}>
              {consentTypeVi[c.type] ?? c.name}: {consentStatusVi[c.status] ?? c.status}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function dedupeConsents(list: CustomerDetail['consents']) {
  const seen = new Map<string, CustomerDetail['consents'][number]>();
  for (const c of list) if (!seen.has(c.type)) seen.set(c.type, c);
  return [...seen.values()];
}

function roleLabel(roles: string[]): string {
  const retail = roles.includes('retail_customer');
  const wholesale = roles.includes('wholesale_contact');
  if (retail && wholesale) return 'Cả hai (lẻ + sỉ)';
  if (wholesale) return 'Sỉ';
  if (retail) return 'Lẻ';
  return 'Chưa phân loại';
}

function InfoTab({ detail, onSaved }: { detail: CustomerDetail; onSaved: () => void }) {
  return (
    <div className="stack-4">
      <div className="card card-pad">
        <div className="info-grid">
          <div className="info-item">
            <span className="label">Tên đầy đủ</span>
            <span className="value">{detail.fullName}</span>
          </div>
          <div className="info-item">
            <span className="label">Kênh ưu tiên</span>
            <span className="value">{detail.preferredChannel ?? 'Chưa đặt'}</span>
          </div>
          <div className="info-item">
            <span className="label">Trạng thái</span>
            <span className="value">{detail.retentionStatus === 'active' ? 'Đang chăm sóc' : detail.retentionStatus}</span>
          </div>
          <div className="info-item">
            <span className="label">Số bé</span>
            <span className="value num">{detail.babyCount}</span>
          </div>
        </div>
      </div>

      <div className="card card-pad stack-2">
        <div className="between">
          <h3 className="h3">Số điện thoại</h3>
        </div>
        {detail.phones.map((p) => (
          <div key={p.id} className="kv-field">
            <span className="num">{p.phone ?? '—'}</span>
            <span className="row" style={{ gap: 6 }}>
              <span className="caption">{p.isPrimary ? 'Chính' : p.type}</span>
              {p.source === 'KV' && <KvBadge />}
            </span>
          </div>
        ))}
        <p className="caption">Số điện thoại là dữ liệu nguồn KiotViet, chỉ đọc trong CRM.</p>
      </div>

      <ContactChannelsCard detail={detail} onSaved={onSaved} />

      {detail.note && (
        <div className="card card-pad">
          <h3 className="h3" style={{ marginBottom: 8 }}>
            Ghi chú CRM
          </h3>
          <p className="wrap-anywhere">{detail.note}</p>
        </div>
      )}
    </div>
  );
}

// Guard phòng thủ phía client (nhiều lớp): server đã chuẩn hóa link về http(s) tới host FB/Zalo,
// nhưng UI vẫn kiểm lại — CHỈ render <a href> khi link là http(s), tránh mọi href javascript:/data:.
function isSafeHttpUrl(v: string | null): v is string {
  return !!v && (v.startsWith('https://') || v.startsWith('http://'));
}

function SocialLinkView({
  label,
  channel,
  url,
  icon: Icon,
}: {
  label: string;
  channel: string;
  url: string | null;
  icon: typeof Facebook;
}) {
  return (
    <div className="info-item">
      <span className="label">{label}</span>
      {isSafeHttpUrl(url) ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline btn-sm"
          style={{ alignSelf: 'flex-start' }}
        >
          <Icon size={15} aria-hidden />
          Nhắn tin {channel}
          <ExternalLink size={13} aria-hidden />
        </a>
      ) : url ? (
        // Link không phải http(s) (bất thường) => hiện text thường, KHÔNG tạo href.
        <span className="value wrap-anywhere">{url}</span>
      ) : (
        <span className="value muted">Chưa có</span>
      )}
    </div>
  );
}

function ContactChannelsCard({
  detail,
  onSaved,
}: {
  detail: CustomerDetail;
  onSaved: () => void;
}) {
  const { permissions } = useAuth();
  const toast = useToast();
  const canManage = permissions?.manageCustomer ?? false;
  const [editing, setEditing] = useState(false);
  const [fb, setFb] = useState('');
  const [zalo, setZalo] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setFb(detail.facebook ?? '');
    setZalo(detail.zalo ?? '');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/customers/${detail.id}/social-links`, {
        facebook: fb.trim(),
        zalo: zalo.trim(),
      });
      toast('success', 'Đã cập nhật kênh liên hệ.');
      setEditing(false);
      onSaved();
    } catch (err) {
      // 400 (link sai) / 403 (thiếu quyền) => hiện đúng thông điệp từ server.
      toast('error', err instanceof ApiError ? err.message : 'Không lưu được kênh liên hệ.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad stack-2">
      <div className="between">
        <h3 className="h3">Kênh liên hệ</h3>
        {canManage && !editing && (
          <button
            className="btn btn-ghost btn-icon"
            aria-label="Sửa kênh liên hệ"
            onClick={startEdit}
          >
            <Pencil size={15} aria-hidden />
          </button>
        )}
      </div>

      {editing ? (
        <div className="stack-2">
          <div className="field">
            <label className="label" htmlFor="cust-fb">
              Facebook
            </label>
            <input
              id="cust-fb"
              className="input"
              value={fb}
              onChange={(e) => setFb(e.target.value)}
              placeholder="facebook.com/… hoặc tên trang"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="cust-zalo">
              Zalo
            </label>
            <input
              id="cust-zalo"
              className="input"
              value={zalo}
              onChange={(e) => setZalo(e.target.value)}
              placeholder="zalo.me/… hoặc số điện thoại"
              autoComplete="off"
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              <Check size={15} aria-hidden />
              Lưu
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              <X size={15} aria-hidden />
              Hủy
            </button>
          </div>
          <p className="caption">
            Để trống rồi Lưu để gỡ liên kết. Chỉ nhận liên kết Facebook / Zalo.
          </p>
        </div>
      ) : (
        <div className="info-grid">
          <SocialLinkView label="Facebook" channel="Facebook" url={detail.facebook} icon={Facebook} />
          <SocialLinkView label="Zalo" channel="Zalo" url={detail.zalo} icon={MessageCircle} />
        </div>
      )}
    </div>
  );
}

function ConsultationsTab({ customerId }: { customerId: string }) {
  const { permissions } = useAuth();
  const canManage = permissions?.manageBaby ?? false;
  const state = useApi<{ items: Consultation[] }>(
    () => api.get(`/api/customers/${customerId}/consultations`),
    [customerId],
  );
  // 'new' để tạo mới; object Consultation để sửa.
  const [editing, setEditing] = useState<Consultation | 'new' | null>(null);

  return (
    <div className="stack-4">
      {canManage && (
        <div className="between">
          <h3 className="h3">Ghi chú tư vấn</h3>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            <MessageSquarePlus size={16} aria-hidden />
            Ghi tư vấn
          </button>
        </div>
      )}

      {state.status === 'loading' && <SkeletonCards count={2} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState
            title="Chưa có buổi tư vấn nào"
            hint="Ghi lại vấn đề của khách/bé và sản phẩm đã tư vấn."
            action={
              canManage ? (
                <button className="btn btn-primary" onClick={() => setEditing('new')}>
                  <Plus size={16} aria-hidden />
                  Ghi tư vấn đầu tiên
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="stack">
            {state.data.items.map((c) => (
              <div key={c.id} className="card card-pad stack-2">
                <div className="between">
                  <b className="wrap-anywhere">{c.issue}</b>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="caption">{c.createdAt}</span>
                    {canManage && (
                      <button
                        className="btn btn-ghost btn-icon"
                        aria-label="Sửa tư vấn"
                        onClick={() => setEditing(c)}
                      >
                        <Pencil size={15} aria-hidden />
                      </button>
                    )}
                  </span>
                </div>
                <div className="row-wrap" style={{ gap: 6 }}>
                  {c.temperature && (
                    <Badge tone={temperatureTone[c.temperature] ?? 'neutral'} icon={false}>
                      {temperatureVi[c.temperature] ?? c.temperature}
                    </Badge>
                  )}
                  {c.result && (
                    <Badge tone={consultationResultTone[c.result] ?? 'neutral'} icon={false}>
                      {consultationResultVi[c.result] ?? c.result}
                    </Badge>
                  )}
                  {c.advisedProductIds.length > 0 && (
                    <Badge tone="primary" icon={false}>
                      {c.advisedProductIds.length} SP đã tư vấn
                    </Badge>
                  )}
                  {c.editedCount > 0 && (
                    <Badge tone="neutral" icon={false}>Đã sửa {c.editedCount} lần</Badge>
                  )}
                </div>
                {c.reasonNoBuy && (
                  <p className="small muted wrap-anywhere">Lý do chưa mua: {c.reasonNoBuy}</p>
                )}
                {c.note && <p className="small wrap-anywhere">{c.note}</p>}
                {c.nextContactDate && (
                  <span className="caption">Hẹn liên hệ lại: {c.nextContactDate}</span>
                )}
              </div>
            ))}
          </div>
        ))}

      {editing && (
        <ConsultationModal
          customerId={customerId}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      )}
    </div>
  );
}

function PurchasesTab({ customerId }: { customerId: string }) {
  const state = useApi<PurchasesResponse>(
    () => api.get(`/api/customers/${customerId}/purchases`),
    [customerId],
  );
  if (state.status === 'loading') return <SkeletonCards count={2} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data.items.length === 0)
    return <EmptyState title="Chưa có lịch sử mua" hint="Hợp nhất hóa đơn của mọi mã KiotViet." />;
  return (
    <div className="stack-4">
      <p className="caption">
        <KvBadge /> Lịch sử hợp nhất từ mọi mã KiotViet đã liên kết.
      </p>
      {state.data.items.map((inv) => (
        <div key={inv.kvInvoiceId} className="card card-pad stack-2">
          <div className="between">
            <b>{inv.code}</b>
            <span className="row" style={{ gap: 8 }}>
              <span className="caption">{inv.purchaseDate}</span>
              <Badge tone={inv.status === 'completed' ? 'success' : 'neutral'} icon={false}>
                {invoiceStatusVi[inv.status] ?? inv.status}
              </Badge>
            </span>
          </div>
          <div className="list-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Sản phẩm</th>
                  <th>SL</th>
                  <th>Đơn giá</th>
                  <th>Phân bổ bé</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.product}</td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{vnd(l.price)}</td>
                    <td>
                      <Badge tone="neutral" icon={false}>
                        {assignmentStatusVi[l.allocationStatus] ?? l.allocationStatus}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="between">
            <span className="caption">Tổng hóa đơn</span>
            <b className="num">{vnd(inv.total)}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

interface CareFollowUp {
  id: string;
  reminderType: string;
  status: string;
  dueDate: string;
  content: string | null;
  // Chỉ vai processWork nhận mảng có phần tử; vai khác => [].
  attachments: FollowUpAttachmentBrief[];
}

function CareTab({ customerId }: { customerId: string }) {
  const { permissions } = useAuth();
  const canSeeEvidence = permissions?.processWork ?? false;
  const state = useApi<{ items: CareFollowUp[] }>(
    () => api.get(`/api/customers/${customerId}/followups`),
    [customerId],
  );
  if (state.status === 'loading') return <SkeletonCards count={2} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data.items.length === 0)
    return <EmptyState title="Không có nhắc chăm sóc nào" hint="Các việc nhắc sẽ hiển thị tại đây." />;
  return (
    <div className="stack">
      {state.data.items.map((f) => (
        <div key={f.id} className="card card-pad stack-2">
          <div className="between">
            <Badge tone="primary" icon={false}>
              {reminderTypeVi[f.reminderType] ?? f.reminderType}
            </Badge>
            <span className="caption">Đến hạn {f.dueDate}</span>
          </div>
          {f.content && <p className="small wrap-anywhere">{f.content}</p>}
          {/* 🔴 Ảnh bằng chứng chỉ hiện cho vai xử lý việc (Marketing không thấy — server cũng trả []). */}
          {canSeeEvidence && f.attachments.length > 0 && (
            <div className="row-wrap" style={{ gap: 8 }}>
              {f.attachments.map((a) => (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${a.uploadedByName ?? 'Không rõ'} · ${a.createdAt}`}
                >
                  <img
                    src={a.url}
                    alt={`Ảnh bằng chứng — ${a.uploadedByName ?? 'không rõ'}`}
                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ConsentTab({ customerId }: { customerId: string }) {
  const state = useApi<{ items: ConsentEvent[] }>(
    () => api.get(`/api/customers/${customerId}/consents`),
    [customerId],
  );
  if (state.status === 'loading') return <SkeletonCards count={2} />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data.items.length === 0)
    return <EmptyState title="Chưa có sự kiện consent" hint="Lịch sử đồng ý / rút lại sẽ hiển thị tại đây." />;
  return (
    <div className="card list-card">
      <div className="list-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Trạng thái</th>
              <th>Thời điểm</th>
            </tr>
          </thead>
          <tbody>
            {state.data.items.map((e, i) => (
              <tr key={i}>
                <td>{consentTypeVi[e.type] ?? e.name}</td>
                <td>
                  <Badge tone={e.status === 'granted' ? 'success' : 'neutral'} icon={false}>
                    {consentStatusVi[e.status] ?? e.status}
                  </Badge>
                </td>
                <td className="num">{e.at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

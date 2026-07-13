import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Phone, Baby as BabyIcon, Link2, GitMerge } from 'lucide-react';
import { api } from '../api/client';
import type { CustomerListResponse, CustomerSummary, DedupResponse } from '../api/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../app/AuthContext';
import { Badge, EmptyState, ErrorState, KvBadge, SkeletonTable } from '../components/ui';

export function CustomerListScreen() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [hasBaby, setHasBaby] = useState('');
  const [applied, setApplied] = useState({ search: '', role: '', hasBaby: '' });

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (applied.search) p.set('search', applied.search);
    if (applied.role) p.set('role', applied.role);
    if (applied.hasBaby) p.set('hasBaby', applied.hasBaby);
    p.set('take', '100');
    return p.toString();
  }, [applied]);

  const state = useApi<CustomerListResponse>(
    () => api.get<CustomerListResponse>(`/api/customers?${query}`),
    [query],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied({ search, role, hasBaby });
  };

  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Khách hàng</h1>
          <p className="small muted">Tìm và mở hồ sơ 360 của khách lẻ / đại lý.</p>
        </div>
        <MergeEntry />
      </div>

      <form className="toolbar" onSubmit={submit}>
        <div className="search-box">
          <Search size={18} className="search-icon" aria-hidden />
          <input
            className="input"
            placeholder="Tìm theo tên hoặc số điện thoại…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm khách hàng"
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Lọc theo vai">
          <option value="">Tất cả vai</option>
          <option value="retail_customer">Khách lẻ</option>
          <option value="wholesale_contact">Liên hệ sỉ</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={hasBaby} onChange={(e) => setHasBaby(e.target.value)} aria-label="Lọc theo bé">
          <option value="">Có bé / chưa</option>
          <option value="true">Có hồ sơ bé</option>
          <option value="false">Chưa có bé</option>
        </select>
        <button className="btn btn-primary" type="submit">
          Tìm
        </button>
      </form>

      {state.status === 'loading' && <SkeletonTable rows={8} cols={6} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState
            title="Không tìm thấy khách hàng"
            hint={state.data.note ?? 'Thử đổi từ khóa hoặc bỏ bớt bộ lọc.'}
          />
        ) : (
          <CustomerTable items={state.data.items} />
        ))}
    </div>
  );
}

/** Badge "khách nghi trùng" → màn Gộp (chỉ chủ shop — approveMerge). */
function MergeEntry() {
  const { permissions } = useAuth();
  const canMerge = permissions?.approveMerge ?? false;
  const state = useApi<DedupResponse>(
    () => (canMerge ? api.get('/api/customers/dedup-candidates') : Promise.resolve({ threshold: 0, note: '', masked: false, items: [] })),
    [canMerge],
  );
  if (!canMerge) return null;
  const count = state.status === 'success' ? state.data.items.length : null;
  return (
    <Link className="btn btn-outline btn-sm" to="/gop-khach">
      <GitMerge size={15} aria-hidden />
      {count != null && count > 0 ? `${count} cặp khách nghi trùng` : 'Gộp khách nghi trùng'}
    </Link>
  );
}

function CustomerTable({ items }: { items: CustomerSummary[] }) {
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/khach/${id}`);

  return (
    <>
      {/* Desktop: bảng */}
      <div className="card list-card">
        <div className="list-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Tên hiển thị</th>
                <th>Số điện thoại</th>
                <th>Vai</th>
                <th>Liên kết KV</th>
                <th>Số bé</th>
                <th>Mua cuối</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="link-row" onClick={() => open(c.id)}>
                  <td>
                    <span className="link-name">{c.displayName}</span>
                  </td>
                  <td className="num">{c.phone ?? '—'}</td>
                  <td>{c.roleLabel}</td>
                  <td>{c.kvLinks > 0 ? `${c.kvLinks} mã` : 'CRM only'}</td>
                  <td className="num">{c.babyCount}</td>
                  <td className="num">{c.lastPurchaseAt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: card */}
      <div className="cust-cards">
        {items.map((c) => (
          <button key={c.id} className="card cust-card" onClick={() => open(c.id)}>
            <div className="between">
              <span className="cust-card-name link-name">{c.displayName}</span>
              <Badge tone={c.roles.includes('wholesale_contact') ? 'primary' : 'neutral'} icon={false}>
                {c.roleLabel}
              </Badge>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <Phone size={14} aria-hidden className="muted" />
              <span className="num">{c.phone ?? '—'}</span>
            </div>
            <div className="row-wrap" style={{ gap: 12 }}>
              <span className="small muted">
                <Link2 size={13} aria-hidden style={{ verticalAlign: '-2px' }} />{' '}
                {c.kvLinks > 0 ? `${c.kvLinks} mã KV` : 'CRM only'}
              </span>
              <span className="small muted">
                <BabyIcon size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> {c.babyCount} bé
              </span>
              {c.lastPurchaseAt && <span className="small muted">Mua cuối {c.lastPurchaseAt}</span>}
            </div>
          </button>
        ))}
      </div>
      <p className="caption" style={{ marginTop: 12 }}>
        <KvBadge /> Số điện thoại và mã khách lấy từ KiotViet. Doanh thu tích lũy xem trong hồ sơ 360.
      </p>
    </>
  );
}

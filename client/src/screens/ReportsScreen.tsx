import {
  Activity,
  BarChart3,
  Database,
  Info,
  Repeat,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  AgencyReasonsReport,
  DataQualityReport,
  RepurchaseReport,
  UpliftResponse,
  UpliftResult,
} from '../api/types';
import { useApi } from '../hooks/useApi';
import { Badge, EmptyState, ErrorState, SkeletonCards } from '../components/ui';
import { declineReasonVi } from '../lib/labels';
import type { Tone } from '../lib/labels';

export function ReportsScreen() {
  return (
    <div>
      <div className="page-head">
        <div className="page-title">
          <h1 className="h1">Báo cáo</h1>
          <p className="small muted">
            Đo tác động thật của CRM — chỉ dựa trên dữ liệu đã xác minh, không phóng đại.
          </p>
        </div>
      </div>

      <div className="stack-4">
        <UpliftSection />
        <RepurchaseSection />
        <AgencyReasonsSection />
        <DataQualitySection />
        <MetricDictionary />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RPT-04 Tác động thật (incremental uplift) — render theo status tier  */
/* ------------------------------------------------------------------ */

function UpliftSection() {
  const state = useApi<UpliftResponse>(() => api.get('/api/reports/incremental-uplift'), []);
  return (
    <section className="card card-pad stack-4">
      <SectionHead
        icon={<Activity size={18} aria-hidden />}
        title="Tác động thật (Incremental uplift)"
        subtitle="% mua lại nhóm được nhắc − % mua lại nhóm đối chứng (holdout)."
      />
      {state.status === 'loading' && <SkeletonCards count={1} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' && <UpliftBody data={state.data} />}
    </section>
  );
}

function UpliftBody({ data }: { data: UpliftResponse }) {
  if (!data.result) {
    return (
      <EmptyState
        title="Chưa có thí nghiệm đang chạy"
        hint={data.note ?? 'Cần bật một thí nghiệm holdout để đo tác động.'}
      />
    );
  }
  const r = data.result;
  const g = data.groups;
  const min = data.minSample;

  return (
    <div className="stack-4">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="stack-2" style={{ gap: 2 }}>
          {data.experiment && <b>{data.experiment.name}</b>}
          <span className="caption">Chỉ tính Attributed CRM conversion (mua sau liên hệ, gắn follow-up).</span>
        </div>
        <Badge tone={upliftTone(r)} icon={false}>
          {r.label}
        </Badge>
      </div>

      {/* Kích thước nhóm + ngưỡng mẫu */}
      {g && (
        <div className="info-grid">
          <div className="metric">
            <span className="label">Nhóm được nhắc</span>
            <span className="metric-value num">{g.treatment.n}</span>
            <span className="caption num">
              {g.treatment.conversions} mua lại
              {min ? ` · cần ≥ ${min.treatment}` : ''}
            </span>
          </div>
          <div className="metric">
            <span className="label">Nhóm đối chứng</span>
            <span className="metric-value num">{g.holdout.n}</span>
            <span className="caption num">
              {g.holdout.conversions} mua lại
              {min ? ` · cần ≥ ${min.holdout}` : ''}
            </span>
          </div>
        </div>
      )}

      {/* 🔴 Chưa đủ mẫu ⇒ KHÔNG hiển thị kết luận */}
      {!r.hasConclusion ? (
        <div className="notice notice-neutral">
          <Info size={16} aria-hidden />
          <div className="stack-2" style={{ gap: 2 }}>
            <b>Chưa đủ dữ liệu để kết luận.</b>
            <span className="small">
              {r.status === 'collecting'
                ? 'Đang thu thập — chưa có đủ khách trong các nhóm để so sánh.'
                : 'Số mẫu chưa đạt ngưỡng tối thiểu. Chưa đưa ra con số tác động để tránh kết luận sai.'}
              {' '}
              Tỷ lệ tham khảo:{' '}
              {r.treatmentRate != null ? pctFrac(r.treatmentRate) : '—'} (nhắc) ·{' '}
              {r.holdoutRate != null ? pctFrac(r.holdoutRate) : '—'} (đối chứng).
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="info-grid">
            <div className="metric">
              <span className="label">% mua lại (được nhắc)</span>
              <span className="metric-value num">{pctFrac(r.treatmentRate)}</span>
            </div>
            <div className="metric">
              <span className="label">% mua lại (đối chứng)</span>
              <span className="metric-value num">{pctFrac(r.holdoutRate)}</span>
            </div>
            <div className="metric">
              <span className="label">Chênh lệch (uplift)</span>
              <span className={`metric-value num ${(r.uplift ?? 0) >= 0 ? 'trend-up' : 'trend-down'}`}>
                {ppFrac(r.uplift)}
              </span>
              <span className="caption">
                {r.ci95 ? `Khoảng tin cậy 95%: ${ppFrac(r.ci95.low)} … ${ppFrac(r.ci95.high)}` : ''}
              </span>
            </div>
          </div>
          {r.status === 'reference' && (
            <div className="notice notice-warning">
              <TriangleAlert size={16} aria-hidden />
              <span className="small">
                Có thể tham khảo nhưng CHƯA đủ tin cậy thống kê (khoảng tin cậy còn bao gồm 0) —
                chưa nên dùng để ra quyết định lớn.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function upliftTone(r: UpliftResult): Tone {
  if (!r.hasConclusion) return r.status === 'collecting' ? 'primary' : 'neutral';
  if (r.status === 'confident') return (r.uplift ?? 0) >= 0 ? 'success' : 'danger';
  return 'warning';
}

/* ------------------------------------------------------------------ */
/* RPT-03 Tỷ lệ mua lại                                                 */
/* ------------------------------------------------------------------ */

function RepurchaseSection() {
  const state = useApi<RepurchaseReport>(() => api.get('/api/reports/repurchase'), []);
  return (
    <section className="card card-pad stack-4">
      <SectionHead
        icon={<Repeat size={18} aria-hidden />}
        title="Tỷ lệ mua lại"
        subtitle="Tách rõ 'có hóa đơn' (verified) vs 'do CRM tác động' (attributed) vs tự nhiên."
      />
      {state.status === 'loading' && <SkeletonCards count={1} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' && (
        <div className="stack-4">
          <div className="info-grid">
            <div className="metric">
              <span className="label">Mua lại có hóa đơn (verified)</span>
              <span className="metric-value num">{state.data.repurchaseVerified}</span>
              <span className="caption num">{state.data.repurchaseVerifiedRatePct}% số việc nhắc</span>
            </div>
            <div className="metric">
              <span className="label">Do CRM tác động (attributed)</span>
              <span className="metric-value num">{state.data.attributedAfterReminder}</span>
              <span className="caption num">{state.data.attributedRatePct}% số việc nhắc</span>
            </div>
            <div className="metric">
              <span className="label">Mua lại tự nhiên</span>
              <span className="metric-value num">{state.data.naturalRepurchase}</span>
              <span className="caption">verified nhưng không gắn được với lần nhắc</span>
            </div>
            <div className="metric">
              <span className="label">Tổng việc nhắc tái mua</span>
              <span className="metric-value num">{state.data.totalConsumptionFollowUps}</span>
            </div>
          </div>
          <div>
            <span className="label">Mua lại theo kỳ (khoảng cách ngày nhắc → ngày mua)</span>
            <div className="row-wrap" style={{ gap: 8, marginTop: 6 }}>
              <Badge tone="success" icon={false}>≤ 30 ngày: {state.data.byPeriod.d30}</Badge>
              <Badge tone="primary" icon={false}>31–60: {state.data.byPeriod.d60}</Badge>
              <Badge tone="attention" icon={false}>61–90: {state.data.byPeriod.d90}</Badge>
              <Badge tone="neutral" icon={false}>&gt; 90: {state.data.byPeriod.over90}</Badge>
            </div>
          </div>
          <p className="caption">
            Chỉ <b>Attributed CRM conversion</b> mới dùng cho báo cáo tác động. "Verified" chỉ nói có
            hóa đơn, không khẳng định do CRM.
          </p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* RPT-05 Lý do đại lý giảm/ngừng nhập — CHỈ reasonStatus=confirmed      */
/* ------------------------------------------------------------------ */

function AgencyReasonsSection() {
  const state = useApi<AgencyReasonsReport>(() => api.get('/api/reports/agency-reasons'), []);
  return (
    <section className="card card-pad stack-4">
      <SectionHead
        icon={<BarChart3 size={18} aria-hidden />}
        title="Lý do đại lý giảm/ngừng nhập"
        subtitle="Chỉ tính lý do ĐÃ XÁC NHẬN (loại 'chưa xác định')."
      />
      {state.status === 'loading' && <SkeletonCards count={1} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' &&
        (state.data.items.length === 0 ? (
          <EmptyState
            title="Chưa có lý do nào được xác nhận"
            hint="Lý do chỉ xuất hiện khi đại lý được ghi nhận declineReason đã xác nhận."
          />
        ) : (
          <ReasonBars items={state.data.items} />
        ))}
    </section>
  );
}

function ReasonBars({ items }: { items: AgencyReasonsReport['items'] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  const sorted = [...items].sort((a, b) => b.count - a.count);
  return (
    <div className="stack-2">
      {sorted.map((it) => (
        <div key={it.declineReason ?? 'null'} className="bar-row">
          <span className="bar-label">
            {it.declineReason ? declineReasonVi[it.declineReason] ?? it.declineReason : 'Khác'}
          </span>
          <span className="bar-track" aria-hidden>
            <span className="bar-fill" style={{ width: `${(it.count / max) * 100}%` }} />
          </span>
          <span className="bar-value num">{it.count}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RPT-06 Chất lượng dữ liệu                                            */
/* ------------------------------------------------------------------ */

function DataQualitySection() {
  const state = useApi<DataQualityReport>(() => api.get('/api/reports/data-quality'), []);
  return (
    <section className="card card-pad stack-4">
      <SectionHead
        icon={<Database size={18} aria-hidden />}
        title="Chất lượng dữ liệu"
        subtitle="Khoảng trống cần bổ sung để nhắc đúng và báo cáo tin cậy hơn."
      />
      {state.status === 'loading' && <SkeletonCards count={1} />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={state.reload} />}
      {state.status === 'success' && (
        <div className="stack-4">
          <div className="dq-strip">
            <DqCard label="SP cần khai chu kỳ" value={state.data.productsNeedCycle} tone="warning" />
            <DqCard label="Phân bổ chờ xác nhận" value={state.data.allocationsNeedReview} tone="warning" />
            <DqCard label="Bé thiếu tuổi/ngày sinh" value={state.data.babiesMissingAge} tone="warning" />
            <DqCard label="Khách thiếu consent" value={state.data.customersMissingConsent} tone="warning" />
            <DqCard label="Khách chưa có bé" value={state.data.customersWithoutBaby} tone="neutral" />
          </div>
          <div className="stack-2">
            <span className="label">
              Chất lượng phân bổ bé (trên {state.data.allocationQuality.total} dòng)
            </span>
            <QualityBar
              tone="success"
              label="Đã xác nhận"
              pct={state.data.allocationQuality.confirmedPct}
            />
            <QualityBar
              tone="attention"
              label="Gợi ý chưa xác nhận"
              pct={state.data.allocationQuality.suggestedUnconfirmedPct}
            />
            <QualityBar
              tone="neutral"
              label="Ở cấp khách"
              pct={state.data.allocationQuality.customerLevelPct}
            />
          </div>
          <p className="caption">{state.data.note}</p>
        </div>
      )}
    </section>
  );
}

function QualityBar({
  tone,
  label,
  pct,
}: {
  tone: 'success' | 'attention' | 'neutral';
  label: string;
  pct: number;
}) {
  return (
    <div className="qbar">
      <div className="qbar-head">
        <span className="small">{label}</span>
        <b className="num">{pct}%</b>
      </div>
      <span className="qbar-track" aria-hidden>
        <span className={`qbar-fill tone-${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
    </div>
  );
}

function DqCard({ label, value, tone }: { label: string; value: number; tone: 'warning' | 'neutral' }) {
  // Tái dùng style KPI: cảnh báo (vàng) vs trung tính (xanh).
  return (
    <div className={`card kpi kpi-${tone === 'warning' ? 'warning' : 'primary'}`}>
      <span className="kpi-value num">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MetricDictionary() {
  return (
    <section className="card card-pad stack-2">
      <SectionHead icon={<Info size={18} aria-hidden />} title="Từ điển chỉ số" />
      <ul className="stack-2" style={{ paddingLeft: 18, listStyle: 'disc' }}>
        <li className="small">
          <b>Repurchase verified</b>: khách có hóa đơn mua lại (bất kể có gọi hay không).
        </li>
        <li className="small">
          <b>Attributed CRM conversion</b>: mua lại SAU liên hệ và gắn với việc nhắc cụ thể — chỉ đây
          mới tính là "do CRM".
        </li>
        <li className="small">Nhịp nhập đại lý luôn tính bằng <b>trung vị</b>, không phải trung bình.</li>
        <li className="small">
          Tổng chi tiêu của khách gọi là <b>Doanh thu tích lũy</b> (KHÔNG gọi "LTV").
        </li>
      </ul>
    </section>
  );
}

function SectionHead({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="stack-2" style={{ gap: 2 }}>
      <h2 className="h3 row" style={{ gap: 8 }}>
        <span className="muted">{icon}</span>
        {title}
      </h2>
      {subtitle && <p className="caption">{subtitle}</p>}
    </div>
  );
}

/** 0..1 -> "27.6%". */
function pctFrac(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
/** 0..1 (điểm phần trăm) -> "+13.5 điểm %" / "-32.4 điểm %". */
function ppFrac(v: number | null): string {
  if (v == null) return '—';
  const pp = v * 100;
  const sign = pp > 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)} điểm %`;
}

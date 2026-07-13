import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './app/AuthContext';
import { Shell } from './app/Shell';
import { LoginScreen } from './screens/LoginScreen';
import { WorkTodayScreen } from './screens/WorkTodayScreen';
import { CustomerListScreen } from './screens/CustomerListScreen';
import { Customer360Screen } from './screens/Customer360Screen';
import { AllocationScreen } from './screens/AllocationScreen';
import { OrganizationScreen } from './screens/OrganizationScreen';
import { ProductConfigScreen } from './screens/ProductConfigScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { SyncScreen } from './screens/SyncScreen';
import { MergeScreen } from './screens/MergeScreen';
import { AdminScreen } from './screens/AdminScreen';
import { SystemConfigScreen } from './screens/SystemConfigScreen';
import { ExperimentsScreen } from './screens/ExperimentsScreen';
import type { Permissions } from './api/types';
import type { ReactNode } from 'react';
import { EmptyState } from './components/ui';
import { ShieldAlert } from 'lucide-react';

function FullLoading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="stack-2" style={{ alignItems: 'center' }}>
        <div className="skeleton" style={{ width: 200, height: 16 }} />
        <div className="skeleton" style={{ width: 140, height: 12 }} />
      </div>
    </div>
  );
}

/** Chặn route theo cờ quyền ở UI (server vẫn chặn thật). */
function Guard({ allow, children }: { allow?: (p: Permissions) => boolean; children: ReactNode }) {
  const { permissions } = useAuth();
  if (permissions && allow && !allow(permissions)) {
    return (
      <EmptyState
        icon={<ShieldAlert size={26} />}
        title="Bạn không có quyền truy cập mục này"
        hint="Liên hệ chủ shop nếu bạn cần quyền xem."
      />
    );
  }
  return <>{children}</>;
}

export function App() {
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) return <FullLoading />;

  if (!user) {
    // Chưa đăng nhập => SCR-01 (giữ mọi đường dẫn khác chuyển về đăng nhập).
    return (
      <Routes>
        <Route path="/dang-nhap" element={<LoginScreen />} />
        <Route path="*" element={<Navigate to="/dang-nhap" replace state={{ from: location }} />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/dang-nhap" element={<Navigate to="/viec-hom-nay" replace />} />
        <Route path="/viec-hom-nay" element={<WorkTodayScreen />} />
        <Route path="/khach" element={<CustomerListScreen />} />
        <Route path="/khach/:id" element={<Customer360Screen />} />
        <Route
          path="/phan-bo-be"
          element={
            <Guard allow={(p) => p.viewBaby}>
              <AllocationScreen />
            </Guard>
          }
        />
        <Route
          path="/dai-ly"
          element={
            <Guard allow={(p) => p.viewOrganization}>
              <OrganizationScreen />
            </Guard>
          }
        />
        <Route
          path="/bao-cao"
          element={
            <Guard allow={(p) => p.viewBaby}>
              <ReportsScreen />
            </Guard>
          }
        />
        <Route
          path="/dong-bo"
          element={
            <Guard allow={(p) => p.manageSync}>
              <SyncScreen />
            </Guard>
          }
        />
        <Route
          path="/gop-khach"
          element={
            <Guard allow={(p) => p.approveMerge}>
              <MergeScreen />
            </Guard>
          }
        />
        <Route
          path="/cau-hinh"
          element={
            <Guard allow={(p) => p.viewOrganization || p.viewSync}>
              <ProductConfigScreen />
            </Guard>
          }
        />
        <Route
          path="/quan-tri"
          element={
            <Guard allow={(p) => p.manageUsers}>
              <AdminScreen />
            </Guard>
          }
        />
        <Route
          path="/cau-hinh-he-thong"
          element={
            <Guard allow={(p) => p.manageConfig}>
              <SystemConfigScreen />
            </Guard>
          }
        />
        <Route
          path="/thi-nghiem"
          element={
            <Guard allow={(p) => p.manageConfig}>
              <ExperimentsScreen />
            </Guard>
          }
        />
        <Route path="/" element={<Navigate to="/viec-hom-nay" replace />} />
        <Route
          path="*"
          element={<EmptyState title="Không tìm thấy trang" hint="Đường dẫn không tồn tại." />}
        />
      </Routes>
    </Shell>
  );
}

import './lib/env';
import { env } from './lib/env';
import { createApp } from './app';
import { cleanupStaleThrottle } from './modules/auth/throttle-store';
import { startExperimentScheduler } from './modules/experiments/scheduler';
import { startSyncProcessor } from './modules/sync/sync.scheduler';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CRM Chicbaby server đang chạy tại http://localhost:${env.PORT}`);
});

// 🔴 SEC (CWE-400): dọn định kỳ bảng throttle_entries (mỗi 10 phút) — chặn phình do login-spray,
// bổ sung cho dọn cơ hội. Sản xuất đa-instance nên tách thành cron riêng; ở đây đủ cho 1 instance.
const THROTTLE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const throttleCleanupTimer = setInterval(() => {
  void cleanupStaleThrottle().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Dọn throttle_entries thất bại:', e instanceof Error ? e.message : e);
  });
}, THROTTLE_CLEANUP_INTERVAL_MS);
throttleCleanupTimer.unref(); // không giữ tiến trình sống chỉ vì timer này

// 🔴 §7.1: cron worker holdout tự động (phân nhóm + sinh việc) — chu kỳ đọc từ config experiment.cron_interval_minutes.
const experimentScheduler = startExperimentScheduler();

// 🔴 §11.4: worker xử lý hàng đợi webhook KiotViet (sync_events) — chu kỳ đọc từ sync.processor_interval_minutes.
const syncProcessor = startSyncProcessor();

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(`Cổng ${env.PORT} đang bị chiếm. Đổi PORT trong .env rồi chạy lại.`);
  } else {
    // eslint-disable-next-line no-console
    console.error('Lỗi khởi động server:', err.message);
  }
  process.exit(1);
});

// Tắt gọn khi nhận tín hiệu dừng.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(throttleCleanupTimer);
    experimentScheduler.stop();
    syncProcessor.stop();
    server.close(() => process.exit(0));
  });
}

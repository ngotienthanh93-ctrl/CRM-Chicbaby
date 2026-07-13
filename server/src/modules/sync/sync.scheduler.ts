// 🔴 §11.4 / SYNC — Worker XỬ LÝ hàng đợi sync_events TỰ ĐỘNG theo lịch. Chu kỳ đọc từ config active
// (sync.processor_interval_minutes; 0 = TẮT). Không cần lease đa-instance: processSyncEventsBatch CLAIM từng
// sự kiện (updateMany where status=pending) nên nhiều instance/tick không xử lý trùng. Self-scheduling + unref.
import { prisma } from '../../lib/prisma';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import { processSyncEventsBatch } from './sync.processor';

const MS_PER_MINUTE = 60 * 1000;
/** Khi TẮT (interval ≤ 0), vẫn poll lại config sau chu kỳ này để bật lại không cần restart. */
const DISABLED_RECHECK_MINUTES = 10;

export interface SyncCronPlan {
  enabled: boolean;
  delayMs: number;
}

/** Thuần (test được): interval (phút) → kế hoạch tick kế. ≤0/không hợp lệ ⇒ TẮT (poll lại sau DISABLED_RECHECK). */
export function resolveSyncCronPlan(intervalMinutes: number): SyncCronPlan {
  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    return { enabled: true, delayMs: intervalMinutes * MS_PER_MINUTE };
  }
  return { enabled: false, delayMs: DISABLED_RECHECK_MINUTES * MS_PER_MINUTE };
}

async function readIntervalMinutes(): Promise<number> {
  const row = await prisma.configurationVersion.findFirst({
    where: { key: 'sync.processor_interval_minutes', isActive: true },
  });
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) ? v : DEFAULT_ENGINE_CONFIG.sync.processorIntervalMinutes;
}

export interface SchedulerHandle {
  stop(): void;
}

/** Khởi động worker xử lý sync_events tự động (mirror pattern experiment scheduler). */
export function startSyncProcessor(): SchedulerHandle {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const scheduleNext = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delayMs);
    timer.unref();
  };

  const computePlan = async (): Promise<SyncCronPlan> => {
    try {
      return resolveSyncCronPlan(await readIntervalMinutes());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sync worker] đọc cấu hình lỗi, dùng mặc định:', e instanceof Error ? e.message : e);
      return resolveSyncCronPlan(DEFAULT_ENGINE_CONFIG.sync.processorIntervalMinutes);
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const plan = await computePlan();
    try {
      if (plan.enabled) {
        const r = await processSyncEventsBatch();
        if (r.claimed > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[sync worker] xử lý ${r.claimed}: done=${r.done}, retry=${r.retryable}, dead-letter=${r.deadLettered}`,
          );
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sync worker] lỗi:', e instanceof Error ? e.message : e);
    } finally {
      scheduleNext(plan.delayMs);
    }
  };

  void computePlan().then((plan) => scheduleNext(plan.delayMs));

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

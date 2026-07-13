// 🔴 §7.1 — Cron worker holdout TỰ ĐỘNG: định kỳ phân nhóm holdout + sinh việc.
// Trước đây chỉ chạy TAY qua nút SCR-15 / POST /api/experiments/run; đây là bộ hẹn giờ còn thiếu.
// Logic nghiệp vụ nằm trọn trong run.service.ts (dùng CHUNG với endpoint) — file này CHỈ lo lịch chạy.
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../lib/http';
import { DEFAULT_ENGINE_CONFIG } from '../../lib/config';
import { runExperimentGeneration } from './run.service';

/** ⚙️ Key cấu hình chu kỳ cron (phút). 0 = TẮT. Nguyên tắc #9: cấu hình được, không hard-code. */
const CRON_INTERVAL_KEY = 'experiment.cron_interval_minutes';
const MS_PER_MINUTE = 60 * 1000;
/** Khi cron TẮT (interval ≤ 0), vẫn poll lại config sau chu kỳ này để admin bật lại KHÔNG cần restart. */
const DISABLED_RECHECK_MINUTES = 10;

export interface CronPlan {
  /** Có chạy sinh việc ở tick này không. */
  enabled: boolean;
  /** Khoảng chờ (ms) tới tick kế tiếp. */
  delayMs: number;
}

/**
 * Thuần (test được): từ interval (phút) → kế hoạch tick kế tiếp.
 * - interval hữu hạn & > 0 ⇒ BẬT, delay = interval phút.
 * - ≤ 0 / không hợp lệ ⇒ TẮT, delay = DISABLED_RECHECK_MINUTES (vẫn poll để bật lại khi đổi config).
 */
export function resolveCronPlan(intervalMinutes: number): CronPlan {
  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    return { enabled: true, delayMs: intervalMinutes * MS_PER_MINUTE };
  }
  return { enabled: false, delayMs: DISABLED_RECHECK_MINUTES * MS_PER_MINUTE };
}

/** Đọc interval (phút) từ cấu hình active; fallback DEFAULT khi thiếu/hỏng (DB cũ chưa seed key). */
export async function readCronIntervalMinutes(): Promise<number> {
  const row = await prisma.configurationVersion.findFirst({
    where: { key: CRON_INTERVAL_KEY, isActive: true },
  });
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) ? v : DEFAULT_ENGINE_CONFIG.experiment.cronIntervalMinutes;
}

export interface SchedulerHandle {
  stop(): void;
}

/**
 * 🔴 Khởi động cron worker holdout.
 * - Self-scheduling bằng setTimeout: mỗi tick ĐỌC LẠI interval từ config ⇒ đổi ở SCR-14 có hiệu lực tick sau.
 * - Tick nối tiếp nhau (hẹn tick kế trong `finally`, SAU khi lượt chạy xong) ⇒ KHÔNG bao giờ chồng lượt.
 *   Đơn-instance đủ; đa-instance cần DB lock (xem backlog HANDOFF §5).
 * - try/catch bao trọn ⇒ lỗi 1 lượt KHÔNG làm chết tiến trình; luôn hẹn tick kế.
 * - unref() ⇒ timer không giữ tiến trình sống; tick ĐẦU chờ trọn 1 chu kỳ (không dồn tải lúc boot).
 */
export function startExperimentScheduler(): SchedulerHandle {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const scheduleNext = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delayMs);
    timer.unref();
  };

  // Đọc plan từ config, tự nuốt lỗi đọc config (dùng DEFAULT) — tách khỏi lỗi lúc SINH việc.
  const computePlan = async (): Promise<CronPlan> => {
    try {
      return resolveCronPlan(await readCronIntervalMinutes());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        '[cron holdout] đọc cấu hình lỗi, dùng mặc định:',
        e instanceof Error ? e.message : e,
      );
      return resolveCronPlan(DEFAULT_ENGINE_CONFIG.experiment.cronIntervalMinutes);
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const plan = await computePlan();
    try {
      if (plan.enabled) {
        const r = await runExperimentGeneration({ actorUserId: null, trigger: 'cron' });
        // eslint-disable-next-line no-console
        console.log(
          `[cron holdout] xong: ${r.experiments.length} thí nghiệm, holdout=${r.holdoutCount}, ` +
            `việc tiêu dùng=${r.consumptionCreated}, việc nhập bù=${r.replenishmentCreated}`,
        );
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        // Lease đang bị giữ (lượt khác/manual đang chạy) ⇒ bỏ qua tick này, KHÔNG phải lỗi.
        // eslint-disable-next-line no-console
        console.log('[cron holdout] bỏ qua: một lượt sinh việc khác đang chạy.');
      } else {
        // eslint-disable-next-line no-console
        console.error('[cron holdout] lỗi khi sinh việc:', e instanceof Error ? e.message : e);
      }
    } finally {
      scheduleNext(plan.delayMs);
    }
  };

  // Hẹn tick ĐẦU sau trọn 1 chu kỳ (theo config; fallback DEFAULT nếu đọc lỗi).
  void computePlan().then((plan) => scheduleNext(plan.delayMs));

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

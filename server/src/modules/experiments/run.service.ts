// 🔴 §12.3 SCR-15 — Orchestration "phân bổ holdout + sinh việc" DÙNG CHUNG cho:
//   - endpoint thủ công POST /api/experiments/run (sau reauth), và
//   - cron worker holdout tự động (scheduler.ts, không có user → actorUserId=null).
// Tách ra khỏi router để KHÔNG trùng lặp logic; router chỉ còn lo reauth + HTTP.
// KHÔNG chứa business rule mới — chỉ ghép các bước (a)–(d) đã có + audit.
import { prisma } from '../../lib/prisma';
import { conflict } from '../../lib/http';
import { writeAudit } from '../../security/audit';
import {
  generateConsumptionFollowUps,
  generateReplenishmentFollowUps,
} from '../../engines/generate';
import {
  assignExperiment,
  computeHoldoutCustomerIds,
  resolveGenerationAssignees,
} from './assignment.service';
import { acquireGenerationLease, releaseGenerationLease } from './generationLock';

/** Nguồn kích hoạt một lượt chạy — để phân biệt trong audit (ai/cái gì đã chạy). */
export type GenerationTrigger = 'manual' | 'cron';

export interface RunGenerationResult {
  /** Kết quả phân bổ từng thí nghiệm đang chạy. */
  experiments: Array<{
    id: string;
    name: string;
    assigned: number;
    treatment: number;
    holdout: number;
    excluded: number;
  }>;
  /** Số khách thuộc holdout (hợp nhất mọi thí nghiệm running) — bị loại khỏi việc chủ động. */
  holdoutCount: number;
  consumptionCreated: number;
  replenishmentCreated: number;
}

/**
 * 🔴 Một lượt "chạy sinh việc" hoàn chỉnh (EXP-01/04):
 *   (a) phân bổ MỌI thí nghiệm đang `running` (treatment/holdout, gỡ khách bị loại trừ),
 *   (b) hợp nhất tập holdout của mọi thí nghiệm running,
 *   (c) derive động người nhận việc theo vai,
 *   (d) sinh việc IDEMPOTENT — holdout KHÔNG hiện SCR-02.
 * Ghi audit SAU khi xong (generate tự quản transaction; không bọc chung 1 transaction khổng lồ).
 *
 * `actorUserId`: user chạy tay (manual) hoặc `null` khi cron tự động (audit ghi userId=null, trigger='cron').
 */
export async function runExperimentGeneration(opts: {
  actorUserId: string | null;
  trigger: GenerationTrigger;
}): Promise<RunGenerationResult> {
  // 🔴 A04/TOCTOU: GIỮ lease trước khi làm bất cứ việc gì — chống chạy CHỒNG lượt (cron trùng cron đa-instance,
  // hoặc manual POST /run trúng ngay cron tick). Không giữ được ⇒ 409 (manual) / cron bắt lỗi này để bỏ qua.
  // Token fencing: chỉ nhả đúng lease của mình (xem generationLock).
  const leaseToken = await acquireGenerationLease(opts.trigger);
  if (!leaseToken) {
    throw conflict('Đang có một lượt sinh việc khác chạy. Vui lòng thử lại sau.');
  }
  try {
    // (a) Phân bổ cho MỌI thí nghiệm đang chạy.
    const running = await prisma.experiment.findMany({
      where: { status: 'running' },
      select: { id: true, name: true },
    });
    const experiments: RunGenerationResult['experiments'] = [];
    for (const exp of running) {
      const r = await assignExperiment(exp.id);
      experiments.push({ id: exp.id, name: exp.name, ...r });
    }

    // (b) Hợp nhất tập holdout của mọi thí nghiệm running.
    const holdoutCustomerIds = await computeHoldoutCustomerIds();

    // (c) Người nhận việc (derive động theo vai).
    const assignees = await resolveGenerationAssignees();

    // (d) Sinh việc IDEMPOTENT — holdout KHÔNG hiện SCR-02 (EXP-04).
    const consumptionCreated = await generateConsumptionFollowUps({ ...assignees, holdoutCustomerIds });
    const replenishmentCreated = await generateReplenishmentFollowUps({
      ...assignees,
      holdoutCustomerIds,
    });

    const result: RunGenerationResult = {
      experiments,
      holdoutCount: holdoutCustomerIds.size,
      consumptionCreated,
      replenishmentCreated,
    };

    // Audit SAU khi xong. `trigger` phân biệt chạy tay vs cron; userId=null cho cron.
    await writeAudit({
      userId: opts.actorUserId,
      action: 'experiment.run_generation',
      objectType: 'experiment',
      objectId: null,
      newValue: {
        trigger: opts.trigger,
        experiments: experiments.length,
        holdoutCount: result.holdoutCount,
        consumptionCreated,
        replenishmentCreated,
      },
    });

    return result;
  } finally {
    // Luôn nhả lease dù thành công hay lỗi (TTL chỉ để phòng crash trước khi tới đây).
    // Nhả THEO TOKEN ⇒ không nhả nhầm lease đã bị lượt khác giành nếu lease của mình lỡ hết TTL.
    await releaseGenerationLease(leaseToken);
  }
}

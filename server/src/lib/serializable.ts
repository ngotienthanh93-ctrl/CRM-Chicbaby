// 🔴 CONC-02/03: transaction Serializable là cách chống race read-modify-write, NHƯNG Postgres có thể
// hủy 1 trong 2 giao dịch xung đột (serialization_failure → Prisma P2034). PHẢI retry, nếu không sẽ 500.
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Chạy một transaction Serializable CÓ retry cho lỗi conflict/serialization (P2034).
 * Lỗi nghiệp vụ (badRequest/notFound…) ném trong callback KHÔNG phải P2034 ⇒ bung ra ngay (không retry).
 */
export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        lastErr = e; // xung đột giao dịch — thử lại
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

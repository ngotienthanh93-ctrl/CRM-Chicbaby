// 🔴 SEC-FIX-4 (brute force CWE-307 · AUTH-03/04): giới hạn số lần đăng nhập sai + khóa tạm.
// AUTH-03: khóa 15 phút sau 5 lần sai, 24h sau 10 lần sai.
// AUTH-04: khóa theo (username + IP), KHÔNG khóa toàn cục (tránh DoS 1 tài khoản/ khóa nhầm cả hệ thống).
//
// ⚠️ HẠN CHẾ MVP (cố ý, ghi rõ): bộ đếm nằm TRONG BỘ NHỚ (Map có TTL).
//   - Reset khi restart tiến trình.
//   - KHÔNG chia sẻ giữa nhiều instance (chạy đa-instance sẽ đếm rời rạc).
//   Khi lên production đa-instance: thay bằng bảng DB (login_attempts) hoặc Redis. Schema để hook sau.

export interface ThrottleConfig {
  /** Số lần sai để khóa mềm. */
  softThreshold: number;
  /** Thời gian khóa mềm (ms). */
  softLockMs: number;
  /** Số lần sai để khóa cứng. */
  hardThreshold: number;
  /** Thời gian khóa cứng (ms). */
  hardLockMs: number;
  /** Cửa sổ đếm: quá hạn không bị khóa thì reset bộ đếm (ms). */
  windowMs: number;
}

export const DEFAULT_THROTTLE: ThrottleConfig = {
  softThreshold: 5,
  softLockMs: 15 * 60 * 1000, // 15 phút
  hardThreshold: 10,
  hardLockMs: 24 * 60 * 60 * 1000, // 24 giờ
  windowMs: 24 * 60 * 60 * 1000,
};

interface Entry {
  fails: number;
  firstFailAt: number;
  lockedUntil: number; // 0 = không khóa
}

export interface LockStatus {
  locked: boolean;
  retryAfterMs: number;
}

export interface FailureStatus {
  fails: number;
  locked: boolean;
  retryAfterMs: number;
}

/** Khóa đếm theo (username + ip). Chuẩn hóa username về lowercase để không né bằng khác hoa/thường. */
export function throttleKey(username: string, ip: string | undefined): string {
  return `${username.trim().toLowerCase()}::${ip ?? 'unknown'}`;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly cfg: ThrottleConfig = DEFAULT_THROTTLE) {}

  /** Đang bị khóa không? (kiểm tra TRƯỚC khi thử mật khẩu). */
  isLocked(key: string, now: number = Date.now()): LockStatus {
    const e = this.entries.get(key);
    if (e && e.lockedUntil > now) {
      return { locked: true, retryAfterMs: e.lockedUntil - now };
    }
    return { locked: false, retryAfterMs: 0 };
  }

  /** Ghi nhận 1 lần đăng nhập SAI. Trả trạng thái sau khi cộng dồn. */
  recordFailure(key: string, now: number = Date.now()): FailureStatus {
    let e = this.entries.get(key);
    // Reset bộ đếm nếu cửa sổ cũ đã hết hạn và hiện KHÔNG còn bị khóa.
    if (e && e.lockedUntil <= now && now - e.firstFailAt > this.cfg.windowMs) {
      e = undefined;
    }
    if (!e) {
      e = { fails: 0, firstFailAt: now, lockedUntil: 0 };
      this.entries.set(key, e);
    }
    e.fails += 1;
    if (e.fails >= this.cfg.hardThreshold) {
      e.lockedUntil = now + this.cfg.hardLockMs;
    } else if (e.fails >= this.cfg.softThreshold) {
      e.lockedUntil = now + this.cfg.softLockMs;
    }
    return {
      fails: e.fails,
      locked: e.lockedUntil > now,
      retryAfterMs: e.lockedUntil > now ? e.lockedUntil - now : 0,
    };
  }

  /** Đăng nhập THÀNH CÔNG => xóa bộ đếm cho khóa này. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Dọn thủ công (dùng cho test). */
  reset(): void {
    this.entries.clear();
  }
}

/** Singleton dùng ở router (bộ đếm sống theo tiến trình). */
export const loginThrottle = new LoginThrottle();

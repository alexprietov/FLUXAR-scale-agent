/**
 * RateLimiter
 *
 * Garantiza máximo 1 update/segundo/device.
 * Mantiene el último timestamp de envío por scale_id.
 */

export class RateLimiter {
  private lastSent = new Map<number, number>();
  private intervalMs: number;

  constructor(intervalMs: number = 1000) {
    this.intervalMs = intervalMs;
  }

  canSend(scale_id: number): boolean {
    const last = this.lastSent.get(scale_id) ?? 0;
    return Date.now() - last >= this.intervalMs;
  }

  markSent(scale_id: number): void {
    this.lastSent.set(scale_id, Date.now());
  }

  reset(scale_id: number): void {
    this.lastSent.delete(scale_id);
  }
}

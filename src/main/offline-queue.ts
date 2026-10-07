/**
 * OfflineQueue
 *
 * Cola limitada de lecturas pendientes de envío por scale_id.
 * Máximo MAX_PER_DEVICE por dispositivo.
 *
 * IMPORTANTE:
 * - device_read_at NUNCA se modifica — conserva timestamp real
 * - Una lectura vieja NO puede presentarse como lectura actual
 * - Al reconectar se pueden enviar para auditoría, pero backend
 *   freshness_seconds decidirá si es capturable
 */

import type { ScaleReading } from '../shared/types.js';

const MAX_PER_DEVICE = 100;

export class OfflineQueue {
  private queues = new Map<number, ScaleReading[]>();

  enqueue(reading: ScaleReading): void {
    const q = this.queues.get(reading.scale_id) ?? [];
    q.push(reading);
    // Si excede límite, descartar las más antiguas
    if (q.length > MAX_PER_DEVICE) {
      q.splice(0, q.length - MAX_PER_DEVICE);
    }
    this.queues.set(reading.scale_id, q);
  }

  dequeueAll(scale_id: number): ScaleReading[] {
    const q = this.queues.get(scale_id) ?? [];
    this.queues.set(scale_id, []);
    return q;
  }

  size(scale_id: number): number {
    return this.queues.get(scale_id)?.length ?? 0;
  }

  totalSize(): number {
    let total = 0;
    for (const q of this.queues.values()) total += q.length;
    return total;
  }

  clear(scale_id: number): void {
    this.queues.set(scale_id, []);
  }
}

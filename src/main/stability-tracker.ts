/**
 * StabilityTracker
 *
 * Mantiene una ventana deslizante de muestras por scale_id.
 * Calcula: sample_count, window_started_at, stable_duration_ms,
 *          min_weight_kg, max_weight_kg, is_stable.
 *
 * El backend es la autoridad final sobre is_capturable.
 * Este tracker solo informa al operador y construye el payload.
 */

export interface StabilityConfig {
  threshold_kg: number;       // rango máximo para considerar estable
  min_samples: number;        // mínimo de muestras para declarar estabilidad
  window_ms: number;          // ventana de tiempo en ms
}

export interface StabilitySnapshot {
  sample_count: number;
  window_started_at: number;  // Date.now()
  stable_duration_ms: number;
  min_weight_kg: number;
  max_weight_kg: number;
  is_stable: boolean;
  last_weight_kg: number;
}

interface Sample {
  weight_kg: number;
  ts: number;
}

const DEFAULT_CONFIG: StabilityConfig = {
  threshold_kg: 20,
  min_samples: 3,
  window_ms: 2000,
};

export class StabilityTracker {
  private samples: Sample[] = [];
  private stableStartedAt: number | null = null;
  private config: StabilityConfig;

  constructor(config?: Partial<StabilityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  updateConfig(config: Partial<StabilityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  addSample(weight_kg: number, ts: number = Date.now()): void {
    this.samples.push({ weight_kg, ts });
    // Limpiar muestras fuera de la ventana
    const cutoff = ts - this.config.window_ms;
    this.samples = this.samples.filter(s => s.ts >= cutoff);
  }

  getSnapshot(): StabilitySnapshot | null {
    if (this.samples.length === 0) return null;

    const now = Date.now();
    const cutoff = now - this.config.window_ms;
    const window = this.samples.filter(s => s.ts >= cutoff);

    if (window.length === 0) return null;

    const weights = window.map(s => s.weight_kg);
    const min_weight_kg = Math.min(...weights);
    const max_weight_kg = Math.max(...weights);
    const range = max_weight_kg - min_weight_kg;
    const last_weight_kg = window[window.length - 1].weight_kg;

    const is_stable =
      window.length >= this.config.min_samples &&
      range <= this.config.threshold_kg;

    // Calcular stable_duration_ms
    if (is_stable) {
      if (this.stableStartedAt === null) {
        this.stableStartedAt = window[0].ts;
      }
    } else {
      this.stableStartedAt = null;
    }

    const stable_duration_ms = is_stable && this.stableStartedAt !== null
      ? now - this.stableStartedAt
      : 0;

    return {
      sample_count: window.length,
      window_started_at: window[0].ts,
      stable_duration_ms,
      min_weight_kg,
      max_weight_kg,
      is_stable,
      last_weight_kg,
    };
  }

  reset(): void {
    this.samples = [];
    this.stableStartedAt = null;
  }
}

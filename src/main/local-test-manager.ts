/**
 * LocalTestManager
 *
 * Modo PRUEBA LOCAL — sin enrollment, sin backend, sin company, sin branch.
 * Exclusivamente para diagnóstico físico de la báscula.
 *
 * INVARIANTES:
 *   - NO llama ninguna API
 *   - NO requiere station token
 *   - NO persiste tramas
 *   - Raw frames: máx 10, solo en memoria
 *   - Banner visible: "PRUEBA LOCAL — NO ENVÍA DATOS A FLUXAR"
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import { createParser } from './parsers.js';
import { StabilityTracker } from './stability-tracker.js';
import type { LocalTestConfig, LocalTestState, RawFrame } from '../shared/types.js';

const RAW_FRAME_MAX = 10;
const RAW_FRAME_MAX_CHARS = 256;

// Importación dinámica de serialport
let SerialPortLib: typeof import('serialport') | null = null;
async function getSerialPort() {
  if (!SerialPortLib) SerialPortLib = await import('serialport');
  return SerialPortLib;
}

export class LocalTestManager extends EventEmitter {
  // Eventos: 'update' (LocalTestState)

  private mockMode: boolean;
  private active = false;
  private port: import('serialport').SerialPort | null = null;
  private tracker: StabilityTracker | null = null;
  private mockTimer: ReturnType<typeof setInterval> | null = null;

  private state: LocalTestState = {
    active: false,
    com_port: null,
    serial_open: false,
    weight_kg: null,
    is_stable: false,
    last_frame: null,
    last_error: null,
    raw_frames: [],
  };

  constructor(mockMode: boolean) {
    super();
    this.mockMode = mockMode;
  }

  // ─── Iniciar prueba local ────────────────────────────────────────────────────

  async start(config: LocalTestConfig): Promise<{ ok: boolean; error?: string }> {
    if (this.active) {
      await this.stop();
    }

    this.active = true;
    this.state = {
      active: true,
      com_port: config.com_port,
      serial_open: false,
      weight_kg: null,
      is_stable: false,
      last_frame: null,
      last_error: null,
      raw_frames: [],
    };

    this.tracker = new StabilityTracker({
      threshold_kg: 20,
      min_samples: 3,
      window_ms: 2000,
    });

    log.info(`[LocalTest] Iniciando prueba local en ${config.com_port} (${config.baud_rate} baud)`);

    if (this.mockMode) {
      this._startMockStream(config);
      return { ok: true };
    }

    return this._openSerial(config);
  }

  // ─── Detener prueba local ────────────────────────────────────────────────────

  async stop(): Promise<void> {
    this.active = false;

    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }

    if (this.port?.isOpen) {
      await new Promise<void>(resolve => this.port!.close(() => resolve()));
    }
    this.port = null;
    this.tracker = null;

    this.state = {
      active: false,
      com_port: null,
      serial_open: false,
      weight_kg: null,
      is_stable: false,
      last_frame: null,
      last_error: null,
      raw_frames: [],
    };

    log.info('[LocalTest] Prueba local detenida');
    this._emit();
  }

  // ─── Limpiar tramas ──────────────────────────────────────────────────────────

  clearFrames(): void {
    this.state.raw_frames = [];
    this._emit();
  }

  // ─── Estado actual ───────────────────────────────────────────────────────────

  getState(): LocalTestState {
    return { ...this.state, raw_frames: [...this.state.raw_frames] };
  }

  isActive(): boolean {
    return this.active;
  }

  // ─── Apertura serial ─────────────────────────────────────────────────────────

  private async _openSerial(config: LocalTestConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      // ─── Validación antes de llegar al constructor ────────────────────────
      if (typeof config.com_port !== 'string' || !config.com_port.trim()) {
        const msg = 'No se recibió el puerto COM seleccionado.';
        log.error(`[LocalTest] OPEN_VALIDATION_FAILED: com_port=${JSON.stringify(config.com_port)}`);
        return { ok: false, error: msg };
      }
      if (!Number.isFinite(config.baud_rate) || config.baud_rate <= 0) {
        const msg = `Baud rate inválido: ${config.baud_rate}`;
        log.error(`[LocalTest] OPEN_VALIDATION_FAILED: baud_rate=${config.baud_rate}`);
        return { ok: false, error: msg };
      }

      log.info(`[LocalTest] OPEN_REQUEST com_port=${config.com_port} baud_rate=${config.baud_rate} data_bits=${config.data_bits} parity=${config.parity} stop_bits=${config.stop_bits} protocol=${config.protocol}`);

      const sp = await getSerialPort();
      log.info(`[Serial] OPEN_START path=${config.com_port}`);
      const port = new sp.SerialPort({
        path: config.com_port,
        baudRate: config.baud_rate,
        dataBits: config.data_bits as 5 | 6 | 7 | 8,
        parity: config.parity as 'none' | 'even' | 'odd',
        stopBits: config.stop_bits as 1 | 1.5 | 2,
        autoOpen: false,
      });

      const readline = new sp.ReadlineParser({ delimiter: '\r\n' });
      port.pipe(readline);

      return new Promise((resolve) => {
        port.open((err) => {
          if (err) {
            const msg = `No se pudo abrir ${config.com_port}: ${err.message}`;
            log.error(`[Serial] OPEN_FAILED path=${config.com_port} error=${err.message}`);
            this.state.last_error = msg;
            this.state.serial_open = false;
            this._emit();
            resolve({ ok: false, error: msg });
            return;
          }

          this.port = port;
          this.state.serial_open = true;
          this.state.last_error = null;
          log.info(`[Serial] OPEN_SUCCESS path=${config.com_port}`);
          this._emit();
          resolve({ ok: true });
        });

        readline.on('data', (line: string) => {
          if (!this.active) return;
          this._handleLine(line, config.protocol);
        });

        port.on('error', (err) => {
          this.state.last_error = err.message;
          this.state.serial_open = false;
          log.error('[LocalTest] error serial:', err.message);
          this._emit();
        });

        port.on('close', () => {
          if (!this.active) return;
          this.state.serial_open = false;
          this.state.last_error = 'Puerto cerrado';
          this._emit();
        });
      });

    } catch (err) {
      const msg = String(err);
      this.state.last_error = msg;
      this._emit();
      return { ok: false, error: msg };
    }
  }

  // ─── Procesar línea ──────────────────────────────────────────────────────────

  private _handleLine(line: string, protocol: string): void {
    const rawTruncated = line.slice(0, RAW_FRAME_MAX_CHARS);

    const parser = createParser(protocol);
    const sample = parser.parse(line);

    // Agregar al raw frame viewer (máx 10, no persistidas)
    const frame: RawFrame = {
      received_at: Date.now(),
      raw: rawTruncated,
      parsed_weight: sample?.weight_kg ?? null,
    };

    this.state.raw_frames = [
      frame,
      ...this.state.raw_frames,
    ].slice(0, RAW_FRAME_MAX);

    this.state.last_frame = rawTruncated;

    if (sample && this.tracker) {
      this.tracker.addSample(sample.weight_kg, sample.parsed_at);
      const snapshot = this.tracker.getSnapshot();
      this.state.weight_kg = sample.weight_kg;
      this.state.is_stable = snapshot?.is_stable ?? false;
    }

    this._emit();
  }

  // ─── Mock stream ─────────────────────────────────────────────────────────────

  private _startMockStream(config: LocalTestConfig): void {
    this.state.serial_open = true;
    this._emit();

    let baseWeight = 5000;
    this.mockTimer = setInterval(() => {
      if (!this.active) return;
      const variation = (Math.random() - 0.5) * 8;
      baseWeight = Math.max(0, baseWeight + variation);
      const line = `ST,GS,  ${baseWeight.toFixed(1)} kg`;
      this._handleLine(line, config.protocol);
    }, 100);
  }

  // ─── Emit ────────────────────────────────────────────────────────────────────

  private _emit(): void {
    this.emit('update', this.getState());
  }
}

/**
 * SerialManager
 *
 * Gestiona conexiones seriales independientes por scale_id.
 * Error en una báscula NO detiene las demás.
 * Reconnect con backoff exponencial: 1s → 2s → 5s → 10s → 30s (máx).
 */

import { EventEmitter } from 'events';
import log from 'electron-log';
import type { ParsedSample } from '../shared/types.js';
import { createParser } from './parsers.js';
import { StabilityTracker } from './stability-tracker.js';

// Importación dinámica de serialport para permitir mock en tests
let SerialPortLib: typeof import('serialport') | null = null;

async function getSerialPort() {
  if (!SerialPortLib) {
    SerialPortLib = await import('serialport');
  }
  return SerialPortLib;
}

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

export interface DeviceConfig {
  scale_id: number;
  name: string;
  protocol: string;
  com_port: string;
  baud_rate: number;
  data_bits: number;
  parity: string;
  stop_bits: number;
  stability_threshold_kg: number;
  stability_min_samples?: number;
  stability_window_ms?: number;
}

export interface DeviceRuntimeState {
  scale_id: number;
  serial_open: boolean;
  last_frame_at: number | null;
  last_error: string | null;
  reconnect_attempts: number;
}

// Backoff steps en ms
const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000];

function backoffMs(attempt: number): number {
  return BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)];
}

export class SerialManager extends EventEmitter {
  // Eventos emitidos:
  //   'sample'  (scale_id: number, sample: ParsedSample, snapshot)
  //   'status'  (scale_id: number, state: DeviceRuntimeState)
  //   'error'   (scale_id: number, err: Error)

  private devices = new Map<number, {
    config: DeviceConfig;
    port: import('serialport').SerialPort | null;
    tracker: StabilityTracker;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    state: DeviceRuntimeState;
    stopping: boolean;
  }>();

  private mockMode: boolean;

  constructor(mockMode: boolean) {
    super();
    this.mockMode = mockMode;
  }

  // ─── Listar puertos disponibles ─────────────────────────────────────────────

  async listPorts(): Promise<PortInfo[]> {
    if (this.mockMode) {
      // Puertos simulados para desarrollo/tests — COM4 solo aquí como ejemplo mock
      return [
        { path: 'COM1', manufacturer: 'Mock' },
        { path: 'COM3', manufacturer: 'Mock Serial Adapter' },
        { path: 'COM4', manufacturer: 'Prolific USB-Serial (ejemplo mock)', vendorId: '067B', productId: '2303' },
      ];
    }

    try {
      const sp = await getSerialPort();
      const ports = await sp.SerialPort.list();
      return ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        vendorId: p.vendorId,
        productId: p.productId,
      }));
    } catch (err) {
      log.error('[SerialManager] listPorts error:', err);
      return [];
    }
  }

  // ─── Abrir dispositivo ──────────────────────────────────────────────────────

  async openDevice(config: DeviceConfig): Promise<void> {
    const existing = this.devices.get(config.scale_id);
    if (existing) {
      await this.closeDevice(config.scale_id);
    }

    const tracker = new StabilityTracker({
      threshold_kg: config.stability_threshold_kg,
      min_samples: config.stability_min_samples ?? 3,
      window_ms: config.stability_window_ms ?? 2000,
    });

    const state: DeviceRuntimeState = {
      scale_id: config.scale_id,
      serial_open: false,
      last_frame_at: null,
      last_error: null,
      reconnect_attempts: 0,
    };

    this.devices.set(config.scale_id, {
      config,
      port: null,
      tracker,
      reconnectTimer: null,
      state,
      stopping: false,
    });

    await this._connect(config.scale_id);
  }

  // ─── Cerrar dispositivo ─────────────────────────────────────────────────────

  async closeDevice(scale_id: number): Promise<void> {
    const entry = this.devices.get(scale_id);
    if (!entry) return;

    entry.stopping = true;
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    if (entry.port?.isOpen) {
      await new Promise<void>(resolve => {
        entry.port!.close(() => resolve());
      });
    }

    this.devices.delete(scale_id);
    log.info(`[SerialManager] scale_id=${scale_id} cerrado`);
  }

  // ─── Reconectar ─────────────────────────────────────────────────────────────

  async reconnectDevice(scale_id: number): Promise<void> {
    const entry = this.devices.get(scale_id);
    if (!entry || entry.stopping) return;

    if (entry.port?.isOpen) {
      await new Promise<void>(resolve => entry.port!.close(() => resolve()));
    }
    entry.port = null;
    entry.state.serial_open = false;
    entry.state.reconnect_attempts = 0;

    await this._connect(scale_id);
  }

  // ─── Conexión interna ────────────────────────────────────────────────────────

  private async _connect(scale_id: number): Promise<void> {
    const entry = this.devices.get(scale_id);
    if (!entry || entry.stopping) return;

    const { config, state } = entry;

    if (this.mockMode) {
      // En mock mode simular conexión exitosa
      state.serial_open = true;
      state.last_error = null;
      this.emit('status', scale_id, { ...state });
      this._startMockStream(scale_id);
      return;
    }

    try {
      const sp = await getSerialPort();
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

      port.open((err) => {
        if (err) {
          state.serial_open = false;
          state.last_error = `Puerto ${config.com_port} no disponible: ${err.message}`;
          log.warn(`[SerialManager] scale_id=${scale_id} open error:`, err.message);
          this.emit('status', scale_id, { ...state });
          this._scheduleReconnect(scale_id);
          return;
        }

        state.serial_open = true;
        state.last_error = null;
        state.reconnect_attempts = 0;
        entry.port = port;
        log.info(`[SerialManager] scale_id=${scale_id} abierto en ${config.com_port}`);
        this.emit('status', scale_id, { ...state });
      });

      readline.on('data', (line: string) => {
        this._handleLine(scale_id, line);
      });

      port.on('error', (err) => {
        state.last_error = err.message;
        log.error(`[SerialManager] scale_id=${scale_id} error:`, err.message);
        this.emit('error', scale_id, err);
        this._scheduleReconnect(scale_id);
      });

      port.on('close', () => {
        const e = this.devices.get(scale_id);
        if (!e || e.stopping) return;
        state.serial_open = false;
        state.last_error = 'Puerto cerrado inesperadamente';
        log.warn(`[SerialManager] scale_id=${scale_id} cerrado inesperadamente`);
        this.emit('status', scale_id, { ...state });
        this._scheduleReconnect(scale_id);
      });

    } catch (err) {
      state.last_error = String(err);
      log.error(`[SerialManager] scale_id=${scale_id} _connect error:`, err);
      this.emit('status', scale_id, { ...state });
      this._scheduleReconnect(scale_id);
    }
  }

  // ─── Procesar línea recibida ─────────────────────────────────────────────────

  private _handleLine(scale_id: number, line: string): void {
    const entry = this.devices.get(scale_id);
    if (!entry) return;

    entry.state.last_frame_at = Date.now();
    const parser = createParser(entry.config.protocol);
    const sample = parser.parse(line);

    if (!sample) return;

    entry.tracker.addSample(sample.weight_kg, sample.parsed_at);
    const snapshot = entry.tracker.getSnapshot();

    this.emit('sample', scale_id, sample, snapshot);
  }

  // ─── Mock stream ─────────────────────────────────────────────────────────────

  private _mockTimers = new Map<number, ReturnType<typeof setInterval>>();

  private _startMockStream(scale_id: number): void {
    const existing = this._mockTimers.get(scale_id);
    if (existing) clearInterval(existing);

    let baseWeight = 12480;
    const timer = setInterval(() => {
      const entry = this.devices.get(scale_id);
      if (!entry || entry.stopping) {
        clearInterval(timer);
        return;
      }
      // Simular pequeñas variaciones
      const variation = (Math.random() - 0.5) * 10;
      const weight = Math.max(0, baseWeight + variation);
      baseWeight = weight;

      const line = `ST,GS,  ${weight.toFixed(1)} kg`;
      this._handleLine(scale_id, line);
    }, 100); // ~10 Hz

    this._mockTimers.set(scale_id, timer);
  }

  // ─── Reconnect con backoff ───────────────────────────────────────────────────

  private _scheduleReconnect(scale_id: number): void {
    const entry = this.devices.get(scale_id);
    if (!entry || entry.stopping) return;

    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);

    const delay = backoffMs(entry.state.reconnect_attempts);
    entry.state.reconnect_attempts++;

    log.info(`[SerialManager] scale_id=${scale_id} reconnect en ${delay}ms (intento ${entry.state.reconnect_attempts})`);

    entry.reconnectTimer = setTimeout(async () => {
      const e = this.devices.get(scale_id);
      if (!e || e.stopping) return;
      await this._connect(scale_id);
    }, delay);
  }

  // ─── Estado de todos los dispositivos ───────────────────────────────────────

  getDeviceState(scale_id: number): DeviceRuntimeState | null {
    return this.devices.get(scale_id)?.state ?? null;
  }

  getAllStates(): DeviceRuntimeState[] {
    return Array.from(this.devices.values()).map(e => ({ ...e.state }));
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  async closeAll(): Promise<void> {
    const ids = Array.from(this.devices.keys());
    for (const id of ids) {
      await this.closeDevice(id);
    }
    for (const timer of this._mockTimers.values()) {
      clearInterval(timer);
    }
    this._mockTimers.clear();
  }
}

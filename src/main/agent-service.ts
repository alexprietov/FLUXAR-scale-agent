/**
 * AgentService
 *
 * Orquesta: SerialManager + FluxarApiClient + RateLimiter + OfflineQueue.
 * Maneja heartbeat, envío de lecturas, estado global.
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { FluxarApiClient } from './api-client.js';
import { SerialManager } from './serial-manager.js';
import { LocalTestManager } from './local-test-manager.js';
import { RateLimiter } from './rate-limiter.js';
import { OfflineQueue } from './offline-queue.js';
import { ConfigStore } from './config-store.js';
import { TokenStore } from './token-store.js';
import type {
  AppState, DeviceState, ScaleDevice, DeviceLocalConfig,
  ServerStatus, AppMode, DiagnosticReport, DeviceDiagnostic,
  LocalTestConfig, LocalTestState,
} from '../shared/types.js';
import type { StabilitySnapshot } from './stability-tracker.js';
import type { ParsedSample } from '../shared/types.js';

const APP_VERSION = '0.1.14';
const HEARTBEAT_INTERVAL_MS = 10_000;
const DEVICE_POLL_INTERVAL_MS = 30_000;

export class AgentService extends EventEmitter {
  // Eventos: 'state-change' (AppState)

  private api: FluxarApiClient;
  private serial: SerialManager;
  private localTest: LocalTestManager;
  private rateLimiter = new RateLimiter(1000);
  private queue = new OfflineQueue();
  private config: ConfigStore;
  private tokenStore: TokenStore;
  private mockMode: boolean;

  private serverStatus: ServerStatus = 'SIN_CONEXION';
  private devices: ScaleDevice[] = [];
  private deviceStates = new Map<number, DeviceState>();
  private lastHeartbeatAt: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private devicePollTimer: ReturnType<typeof setInterval> | null = null;
  /** Guard: evita reconciliaciones simultáneas de devices */
  private deviceRefreshInFlight = false;

  // Para diagnóstico: último envío y último error por device
  private lastSentAt = new Map<number, number>();
  private lastSendError = new Map<number, string>();

  constructor(config: ConfigStore, tokenStore: TokenStore, mockMode: boolean) {
    super();
    this.config = config;
    this.tokenStore = tokenStore;
    this.mockMode = mockMode;

    const cfg = config.get();
    this.api = new FluxarApiClient(cfg.api_base_url, mockMode);
    this.serial = new SerialManager(mockMode);
    this.localTest = new LocalTestManager(mockMode);

    // Cargar token si existe
    const token = tokenStore.loadToken();
    if (token) this.api.setToken(token);

    this._bindSerialEvents();
  }

  // ─── Enrollment ─────────────────────────────────────────────────────────────

  async enroll(enrollmentCode: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const deviceIdentifier = this.config.getOrCreateDeviceIdentifier();
      log.info('[Enrollment] DEVICE_IDENTIFIER_READY');
      const result = await this.api.enroll(enrollmentCode, deviceIdentifier, APP_VERSION);
      // saveToken lanza SafeStorageUnavailableError si safeStorage no disponible en producción.
      // Si lanza, el enrollment en el backend YA ocurrió (código consumido, token emitido).
      // En ese caso: limpiar token de memoria, NO dejar la estación en estado inconsistente,
      // y propagar el error para que el renderer muestre el mensaje correcto.
      this.tokenStore.saveToken(result.station_token);
      this.api.setToken(result.station_token);
      this.config.setStationMeta(result.station_id, result.station_name, result.branch_name);
      log.info(`[AgentService] Enrollment exitoso — station_id=${result.station_id}`);
      await this._afterEnrollment();
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message;
      log.error('[AgentService] Enrollment error:', msg);
      // Si el fallo fue al guardar el token (SafeStorageUnavailableError),
      // limpiar cualquier token parcial en memoria y en la API para no quedar
      // en estado inconsistente (backend enrolled, cliente sin token válido).
      if ((err as Error).name === 'SafeStorageUnavailableError') {
        log.warn('[AgentService] Enrollment backend OK pero persistencia local falló — limpiando estado');
        this.tokenStore.clearToken();
        this.api.clearToken();
        this.config.clearStationMeta();
      }
      return { ok: false, error: msg };
    }
  }

  private async _afterEnrollment(): Promise<void> {
    await this._fetchDevices();
    this._startHeartbeat();
    this._startDevicePoll();
    this._emitStateChange();
  }

  // ─── Desvincular ────────────────────────────────────────────────────────────

  async unlink(): Promise<void> {
    this._stopHeartbeat();
    this._stopDevicePoll();
    this.tokenStore.clearToken();
    this.api.clearToken();
    this.config.clearStationMeta();
    await this.serial.closeAll();
    this.devices = [];
    this.deviceStates.clear();
    this.serverStatus = 'SIN_CONEXION';
    log.info('[AgentService] Estación desvinculada');
    this._emitStateChange();
  }

  // ─── Fetch devices (diff inteligente) ────────────────────────────────────────

  private async _fetchDevices(): Promise<void> {
    // Guard: no iniciar si ya hay un refresh en curso
    if (this.deviceRefreshInFlight) {
      log.info('[AgentService] _fetchDevices: refresh ya en curso, omitiendo');
      return;
    }
    this.deviceRefreshInFlight = true;
    try {
      let newDevices: ScaleDevice[];
      try {
        const result = await this.api.getDevices();
        newDevices = result.devices;
      } catch (fetchErr) {
        // Error de red/HTTP: NO interpretar como lista vacía, NO cerrar devices
        log.warn('[AgentService] _fetchDevices: error al obtener devices — manteniendo configuración actual');
        this.emit('fetch-devices-error', String(fetchErr));
        return;
      }

      const prevIds = new Set(this.devices.map(d => d.scale_id));
      const newIds  = new Set(newDevices.map(d => d.scale_id));

      // ── Dispositivos eliminados o desactivados ────────────────────────────
      for (const d of this.devices) {
        if (!newIds.has(d.scale_id)) {
          log.info(`[AgentService] Device ${d.scale_id} (${d.name ?? `Báscula #${d.scale_id}`}) eliminado — cerrando puerto`);
          await this.serial.closeDevice(d.scale_id);
          this.deviceStates.delete(d.scale_id);
        }
      }

      // ── Dispositivos nuevos o modificados ────────────────────────────────
      for (const d of newDevices) {
        const localCfg = this.config.getDeviceConfig(d.scale_id);
        const comPort  = localCfg?.com_port ?? d.com_port ?? null;

        const effectiveCfg: DeviceLocalConfig = {
          scale_id: d.scale_id,
          com_port: comPort,
          baud_rate_override:  localCfg?.baud_rate_override,
          data_bits_override:  localCfg?.data_bits_override,
          parity_override:     localCfg?.parity_override,
          stop_bits_override:  localCfg?.stop_bits_override,
        };

        // Nombre canónico — nunca undefined en logs ni en DeviceState
        const canonicalName = d.name?.trim() || `Báscula #${d.scale_id}`;

        if (!prevIds.has(d.scale_id)) {
          // ── Nuevo ──────────────────────────────────────────────────────
          log.info(`[AgentService] Device ${d.scale_id} (${canonicalName}) nuevo — abriendo puerto`);
          this.deviceStates.set(d.scale_id, {
            scale_id:        d.scale_id,
            name:            canonicalName,
            protocol:        d.protocol,
            com_port:        comPort,
            status:          'DESCONECTADO',
            weight_kg:       null,
            is_stable:       false,
            last_reading_at: null,
            last_sent_at:    null,
            last_error:      null,
            serial_open:     false,
          });
          if (comPort) await this._openDevice(d, effectiveCfg);
        } else {
          // ── Existente — verificar si cambió la configuración ──────────
          const prev = this.devices.find(p => p.scale_id === d.scale_id)!;
          const prevLocalCfg = this.config.getDeviceConfig(prev.scale_id);
          const prevCom  = prevLocalCfg?.com_port ?? prev.com_port ?? null;
          const prevBaud = prevLocalCfg?.baud_rate_override ?? prev.baud_rate;
          const newBaud  = localCfg?.baud_rate_override ?? d.baud_rate;
          const configChanged =
            comPort !== prevCom ||
            newBaud  !== prevBaud ||
            (localCfg?.data_bits_override ?? d.data_bits) !== (prevLocalCfg?.data_bits_override ?? prev.data_bits) ||
            (localCfg?.parity_override    ?? d.parity)    !== (prevLocalCfg?.parity_override    ?? prev.parity)    ||
            (localCfg?.stop_bits_override ?? d.stop_bits) !== (prevLocalCfg?.stop_bits_override ?? prev.stop_bits);

          if (configChanged && comPort) {
            log.info(`[AgentService] Device ${d.scale_id} (${canonicalName}) config modificada — reabriendo puerto`);
            await this.serial.closeDevice(d.scale_id);
            await this._openDevice(d, effectiveCfg);
          }
          // Actualizar nombre/protocolo en estado — siempre con nombre canónico
          const state = this.deviceStates.get(d.scale_id);
          if (state) {
            state.name     = canonicalName;
            state.protocol = d.protocol;
            state.com_port = comPort;
          }
        }
      }

      this.devices = newDevices;
      log.info(`[AgentService] _fetchDevices: ${newDevices.length} dispositivos activos`);
      this._emitStateChange();
    } finally {
      this.deviceRefreshInFlight = false;
    }
  }

  // ─── Device polling ──────────────────────────────────────────────────────────

  private _startDevicePoll(): void {
    // Garantizar un solo timer activo
    this._stopDevicePoll();
    this.devicePollTimer = setInterval(async () => {
      if (!this.api.hasToken()) return;
      // deviceRefreshInFlight actúa como guard dentro de _fetchDevices
      await this._fetchDevices();
    }, DEVICE_POLL_INTERVAL_MS);
  }

  private _stopDevicePoll(): void {
    if (this.devicePollTimer) {
      clearInterval(this.devicePollTimer);
      this.devicePollTimer = null;
    }
  }

  /** Actualización inmediata de devices (botón "Actualizar configuración"). */
  async refreshDevices(): Promise<{ ok: boolean; error?: string }> {
    if (!this.api.hasToken()) return { ok: false, error: 'Sin token' };
    if (this.deviceRefreshInFlight) {
      // Ya hay un refresh en curso — esperar a que termine no es trivial,
      // simplemente informamos que ya está en progreso.
      return { ok: true };
    }
    try {
      await this._fetchDevices();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private async _openDevice(device: ScaleDevice, localCfg: DeviceLocalConfig): Promise<void> {
    await this.serial.openDevice({
      scale_id: device.scale_id,
      name: device.name,
      protocol: device.protocol,
      com_port: localCfg.com_port as string,  // _openDevice solo se llama cuando comPort != null
      baud_rate: localCfg.baud_rate_override ?? device.baud_rate,
      data_bits: localCfg.data_bits_override ?? device.data_bits,
      parity: localCfg.parity_override ?? device.parity,
      stop_bits: localCfg.stop_bits_override ?? device.stop_bits,
      stability_threshold_kg: device.stability_threshold_kg ?? 20,
    });
  }

  // ─── Guardar config de dispositivo ──────────────────────────────────────────

  async saveDeviceConfig(dc: DeviceLocalConfig): Promise<void> {
    this.config.saveDeviceConfig(dc);
    const device = this.devices.find(d => d.scale_id === dc.scale_id);
    if (device) {
      await this.serial.closeDevice(dc.scale_id);
      await this._openDevice(device, dc);
    }
    const state = this.deviceStates.get(dc.scale_id);
    if (state) {
      state.com_port = dc.com_port;
      this._emitStateChange();
    }
  }

  // ─── Serial events ───────────────────────────────────────────────────────────

  private _bindSerialEvents(): void {
    this.serial.on('sample', (scale_id: number, sample: ParsedSample, snapshot: StabilitySnapshot | null) => {
      this._onSample(scale_id, sample, snapshot);
    });

    this.serial.on('status', (scale_id: number, runtimeState: { serial_open: boolean; last_error: string | null }) => {
      const state = this.deviceStates.get(scale_id);
      if (!state) return;
      state.serial_open = runtimeState.serial_open;
      state.last_error = runtimeState.last_error;
      if (!runtimeState.serial_open) {
        state.status = runtimeState.last_error ? 'ERROR' : 'CONECTANDO';
      }
      this._emitStateChange();
    });

    this.serial.on('error', (scale_id: number, err: Error) => {
      const state = this.deviceStates.get(scale_id);
      if (!state) return;
      state.last_error = err.message;
      state.status = 'ERROR';
      this._emitStateChange();
    });
  }

  private _onSample(scale_id: number, sample: ParsedSample, snapshot: StabilitySnapshot | null): void {
    const state = this.deviceStates.get(scale_id);
    if (!state) return;

    state.weight_kg = sample.weight_kg;
    state.last_reading_at = sample.parsed_at;
    state.serial_open = true;

    if (snapshot) {
      state.is_stable = snapshot.is_stable;
      state.status = snapshot.is_stable ? 'ESTABLE' : 'INESTABLE';
    } else {
      state.status = 'INESTABLE';
    }

    this._emitStateChange();

    // Rate limit: máx 1 update/s/device
    if (!this.rateLimiter.canSend(scale_id)) return;
    this.rateLimiter.markSent(scale_id);

    if (!snapshot) return;

    const device = this.devices.find(d => d.scale_id === scale_id);
    const reading = this._buildReading(scale_id, sample, snapshot, device);

    this._sendOrQueue(reading);
  }

  private _buildReading(
    scale_id: number,
    sample: ParsedSample,
    snapshot: StabilitySnapshot,
    device: ScaleDevice | undefined,
  ) {
    // external_reading_id: UUID v4 — se conserva en retry
    const reading = {
      external_reading_id: uuidv4(),
      scale_id,
      weight_kg: sample.weight_kg,
      raw_payload: sample.raw_payload.slice(0, 4096),
      device_read_at: new Date(sample.parsed_at).toISOString(),
      sample_count: snapshot.sample_count,
      window_started_at: new Date(snapshot.window_started_at).toISOString(),
      stable_duration_ms: snapshot.stable_duration_ms,
      min_weight_kg: snapshot.min_weight_kg,
      max_weight_kg: snapshot.max_weight_kg,
      stability_threshold_kg: device?.stability_threshold_kg ?? 20,
      is_stable: snapshot.is_stable,
    };
    return reading;
  }

  private async _sendOrQueue(reading: ReturnType<typeof this._buildReading>): Promise<void> {
    if (!this.api.hasToken()) {
      this.queue.enqueue(reading);
      return;
    }

    try {
      await this.api.postReadings([reading]);
      this.lastSentAt.set(reading.scale_id, Date.now());
      const state = this.deviceStates.get(reading.scale_id);
      if (state) state.last_sent_at = Date.now();
    } catch (err) {
      const msg = (err as Error).message;
      this.lastSendError.set(reading.scale_id, msg);
      if (msg === 'UNAUTHORIZED') {
        this.serverStatus = 'NO_AUTORIZADO';
        this._emitStateChange();
      } else {
        this.serverStatus = 'SIN_CONEXION';
        this.queue.enqueue(reading);
        this._emitStateChange();
      }
    }
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      await this._doHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    // Ejecutar inmediatamente
    void this._doHeartbeat();
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async _doHeartbeat(): Promise<void> {
    if (!this.api.hasToken()) return;
    try {
      await this.api.heartbeat(APP_VERSION);
      this.lastHeartbeatAt = Date.now();
      this.serverStatus = 'CONECTADO';
      this._emitStateChange();
      // Intentar enviar cola offline
      await this._flushQueue();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'UNAUTHORIZED') {
        this.serverStatus = 'NO_AUTORIZADO';
      } else {
        this.serverStatus = 'SIN_CONEXION';
      }
      log.warn('[AgentService] Heartbeat falló:', msg);
      this._emitStateChange();
    }
  }

  private async _flushQueue(): Promise<void> {
    for (const device of this.devices) {
      const pending = this.queue.dequeueAll(device.scale_id);
      if (pending.length === 0) continue;
      try {
        await this.api.postReadings(pending);
        log.info(`[AgentService] Flushed ${pending.length} lecturas offline para scale_id=${device.scale_id}`);
      } catch {
        // Re-encolar si falla
        for (const r of pending) this.queue.enqueue(r);
      }
    }
  }

  // ─── Estado global ───────────────────────────────────────────────────────────

  getAppState(): AppState {
    const cfg = this.config.get();
    return {
      mode: this.mockMode ? 'MOCK' : 'PRODUCTION',
      linked: this.tokenStore.hasToken(),
      station_name: cfg.station_name,
      station_branch: cfg.station_branch,
      server_status: this.serverStatus,
      devices: Array.from(this.deviceStates.values()),
      version: APP_VERSION,
      autostart: cfg.autostart,
      start_minimized: cfg.start_minimized ?? true,
      api_url: cfg.api_base_url ?? null,
    };
  }

  private _emitStateChange(): void {
    this.emit('state-change', this.getAppState());
  }

  // ─── Diagnóstico (sin secrets) ───────────────────────────────────────────────

  /**
   * Diagnóstico seguro del token local.
   * NUNCA expone el token ni el hash completo en logs.
   * Devuelve prefix (8 chars) y SHA-256 para comparar con el servidor.
   */
  private _safeTokenDiagnostic(): {
    token_local_present: boolean;
    token_local_length: number | null;
    token_local_prefix: string | null;
    token_local_hash_sha256: string | null;
  } {
    const token = this.tokenStore.loadToken();
    if (!token) {
      return {
        token_local_present: false,
        token_local_length: null,
        token_local_prefix: null,
        token_local_hash_sha256: null,
      };
    }
    return {
      token_local_present: true,
      token_local_length: token.length,
      token_local_prefix: token.slice(0, 8),
      token_local_hash_sha256: createHash('sha256').update(token, 'utf8').digest('hex'),
    };
  }

  getDiagnostic(): DiagnosticReport {
    const cfg = this.config.get();
    const now = Date.now();

    const deviceDiags: DeviceDiagnostic[] = Array.from(this.deviceStates.values()).map(ds => {
      const lastSent = this.lastSentAt.get(ds.scale_id);
      return {
        scale_id: ds.scale_id,
        name: ds.name,
        com_port: ds.com_port,
        serial_open: ds.serial_open,
        last_frame_ago_ms: ds.last_reading_at ? now - ds.last_reading_at : null,
        last_weight_kg: ds.weight_kg,
        is_stable: ds.is_stable,
        last_sent_ago_ms: lastSent ? now - lastSent : null,
        last_error: ds.last_error,
        queue_size: this.queue.size(ds.scale_id),
      };
    });

    return {
      generated_at: new Date().toISOString(),
      app_version: APP_VERSION,
      mode: this.mockMode ? 'MOCK' : 'PRODUCTION',
      linked: this.tokenStore.hasToken(),
      station_name: cfg.station_name,
      station_id: cfg.station_id,
      server_status: this.serverStatus,
      last_heartbeat: this.lastHeartbeatAt ? new Date(this.lastHeartbeatAt).toISOString() : null,
      api_base_url: cfg.api_base_url,
      devices: deviceDiags,
      // Diagnóstico seguro de token — sin exponer el token
      ...this._safeTokenDiagnostic(),
    };
  }

  // ─── Prueba local ────────────────────────────────────────────────────────────
  // Sin enrollment, sin backend, sin company, sin branch

  async localTestStart(config: LocalTestConfig): Promise<{ ok: boolean; error?: string }> {
    return this.localTest.start(config);
  }

  async localTestStop(): Promise<void> {
    return this.localTest.stop();
  }

  getLocalTestState(): LocalTestState {
    return this.localTest.getState();
  }

  clearLocalTestFrames(): void {
    this.localTest.clearFrames();
  }

  onLocalTestUpdate(cb: (state: LocalTestState) => void): void {
    this.localTest.on('update', cb);
  }

  // ─── Listar puertos ──────────────────────────────────────────────────────────

  async listPorts() {
    return this.serial.listPorts();
  }

  // ─── Autostart ───────────────────────────────────────────────────────────────

  setAutostart(value: boolean): void {
    this.config.setAutostart(value);
  }

  setStartMinimized(value: boolean): void {
    this.config.setStartMinimized(value);
  }

  // ─── Inicializar (si ya hay token) ───────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.tokenStore.hasToken() && this.api.hasToken()) {
      await this._fetchDevices();
      this._startHeartbeat();
      this._startDevicePoll();
    }
    this._emitStateChange();
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    this._stopHeartbeat();
    this._stopDevicePoll();
    await this.serial.closeAll();
    await this.localTest.stop();
  }
}

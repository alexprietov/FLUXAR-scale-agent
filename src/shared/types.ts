// ─── Tipos compartidos entre main, preload y renderer ─────────────────────────

export type DeviceStatus =
  | 'DESCONECTADO'
  | 'CONECTANDO'
  | 'INESTABLE'
  | 'ESTABLE'
  | 'SIN_SEÑAL'
  | 'ERROR';

export type ServerStatus = 'CONECTADO' | 'SIN_CONEXION' | 'NO_AUTORIZADO';

export type AppMode = 'PRODUCTION' | 'MOCK';

// ─── Dispositivo asignado por backend ─────────────────────────────────────────

export interface ScaleDevice {
  scale_id: number;
  name: string;
  protocol: string;           // 'BASYS' | 'GENERIC' | 'CUSTOM'
  baud_rate: number;
  data_bits: number;
  parity: string;             // 'none' | 'even' | 'odd'
  stop_bits: number;
  stability_threshold_kg: number | null;
  freshness_seconds: number | null;
  capacity_kg: number | null;
  // com_port viene del backend (scale_station_devices.com_port).
  // Se usa como valor inicial si no hay config local guardada.
  // El usuario puede sobreescribir con DeviceLocalConfig.
  com_port?: string | null;
}

// ─── Configuración local de un dispositivo (guardada en config store) ─────────

export interface DeviceLocalConfig {
  scale_id: number;
  com_port: string | null;    // null cuando aún no se ha asignado puerto
  baud_rate_override?: number;
  data_bits_override?: number;
  parity_override?: string;
  stop_bits_override?: number;
}

// ─── Estado en tiempo real de un dispositivo ──────────────────────────────────

export interface DeviceState {
  scale_id: number;
  name: string;
  protocol: string;
  com_port: string | null;
  status: DeviceStatus;
  weight_kg: number | null;
  is_stable: boolean;
  last_reading_at: number | null;   // Date.now()
  last_sent_at: number | null;
  last_error: string | null;
  serial_open: boolean;
}

// ─── Lectura normalizada del parser ───────────────────────────────────────────

export interface ParsedSample {
  weight_kg: number;
  unit: string;
  stable_hint: boolean | null;
  raw_payload: string;
  parsed_at: number;          // Date.now()
}

// ─── Update que se envía al backend ───────────────────────────────────────────

export interface ScaleReading {
  external_reading_id: string;    // UUID v4 — no cambiar en retry
  scale_id: number;
  weight_kg: number;
  raw_payload: string;            // máx 4096 chars
  device_read_at: string;         // ISO 8601 — nunca cambiar
  sample_count: number;
  window_started_at: string;      // ISO 8601
  stable_duration_ms: number;
  min_weight_kg: number;
  max_weight_kg: number;
  stability_threshold_kg: number;
  is_stable: boolean;
}

// ─── Configuración de la aplicación (no sensible) ─────────────────────────────

export interface AppConfig {
  api_base_url: string;
  station_name: string | null;
  station_branch: string | null;
  station_id: number | null;
  device_configs: DeviceLocalConfig[];
  autostart: boolean;
  /** Iniciar ventana oculta (minimizada a bandeja) cuando autostart la abre. */
  start_minimized: boolean;
  window_bounds?: { x: number; y: number; width: number; height: number };
  /** UUID estable de instalación. Se genera una vez y persiste entre reinicios. */
  device_identifier?: string;
}

// ─── Estado global para el renderer ───────────────────────────────────────────
// INVARIANTE: AppState NUNCA contiene station_token, token_hash ni enrollment_code

export interface AppState {
  mode: AppMode;
  linked: boolean;
  station_name: string | null;
  station_branch: string | null;
  server_status: ServerStatus;
  devices: DeviceState[];
  version: string;
  autostart: boolean;
  start_minimized: boolean;
  api_url: string | null;
  // token y enrollment code NUNCA incluidos
}

// ─── Modo Prueba Local ─────────────────────────────────────────────────────────
// Sin enrollment, sin backend, sin company, sin branch
// Exclusivamente para diagnóstico físico de la báscula

export interface LocalTestConfig {
  com_port: string;           // desde SerialPort.list() — nunca hardcoded
  baud_rate: number;
  data_bits: number;
  parity: string;
  stop_bits: number;
  protocol: string;
}

export interface LocalTestState {
  active: boolean;
  com_port: string | null;
  serial_open: boolean;
  weight_kg: number | null;
  is_stable: boolean;
  last_frame: string | null;      // última trama raw (no persistida)
  last_error: string | null;
  raw_frames: RawFrame[];         // máx 10, no persistidas, no enviadas
}

export interface RawFrame {
  received_at: number;            // Date.now()
  raw: string;                    // trama truncada a 256 chars
  parsed_weight: number | null;
}

// ─── IPC channels ─────────────────────────────────────────────────────────────

export const IPC = {
  // renderer → main
  GET_STATE:              'get-state',
  ENROLL:                 'enroll',
  LIST_PORTS:             'list-ports',
  SAVE_DEVICE_CONFIG:     'save-device-config',
  GET_DIAGNOSTIC:         'get-diagnostic',
  SET_AUTOSTART:          'set-autostart',
  SET_START_MINIMIZED:    'set-start-minimized',
  REFRESH_DEVICES:        'refresh-devices',
  UNLINK:                 'unlink',

  // Prueba local
  LOCAL_TEST_START:       'local-test-start',
  LOCAL_TEST_STOP:        'local-test-stop',
  LOCAL_TEST_GET_STATE:   'local-test-get-state',
  LOCAL_TEST_CLEAR_FRAMES:'local-test-clear-frames',

  // main → renderer (push)
  STATE_UPDATE:           'state-update',
  LOCAL_TEST_UPDATE:      'local-test-update',
} as const;

// ─── Diagnóstico (sin secrets) ────────────────────────────────────────────────

export interface DiagnosticReport {
  generated_at: string;
  app_version: string;
  mode: AppMode;
  linked: boolean;
  station_name: string | null;
  station_id: number | null;
  server_status: ServerStatus;
  last_heartbeat: string | null;
  api_base_url: string;
  devices: DeviceDiagnostic[];
  // Diagnóstico seguro de token — sin exponer el token ni el hash completo
  // Permite comparar con el servidor sin revelar secretos
  token_local_present: boolean;
  token_local_length: number | null;
  token_local_prefix: string | null;       // primeros 8 chars del token en claro
  token_local_hash_sha256: string | null;  // SHA-256 completo del token (para comparar con DB)
  // token y enrollment code NUNCA incluidos
  // station_token NUNCA incluido
}

export interface DeviceDiagnostic {
  scale_id: number;
  name: string;
  com_port: string | null;
  serial_open: boolean;
  last_frame_ago_ms: number | null;
  last_weight_kg: number | null;
  is_stable: boolean;
  last_sent_ago_ms: number | null;
  last_error: string | null;
  queue_size: number;
}

/**
 * FluxarApiClient
 *
 * Maneja toda comunicación con el backend FLUXAR.
 * En MOCK_MODE no llama producción — simula respuestas localmente.
 * El station token NUNCA se expone al renderer ni se loguea.
 */

import log from 'electron-log';
import type { ScaleDevice, ScaleReading } from '../shared/types.js';

export interface EnrollResponse {
  station_token: string;    // solo se usa aquí, nunca se pasa al renderer
  station_id: number;
  station_name: string;
  branch_name: string;
}

export interface HeartbeatResponse {
  ok: boolean;
}

export interface GetDevicesResponse {
  devices: ScaleDevice[];
}

export interface PostReadingsResponse {
  accepted: number;
  rejected: number;
}

// ─── Mock devices para desarrollo ─────────────────────────────────────────────

const MOCK_DEVICES: ScaleDevice[] = [
  {
    scale_id: 1,
    name: 'Báscula camionera principal',
    protocol: 'BASYS',
    baud_rate: 9600,
    data_bits: 8,
    parity: 'none',
    stop_bits: 1,
    stability_threshold_kg: 20,
    freshness_seconds: 5,
    capacity_kg: 80000,
  },
  {
    scale_id: 2,
    name: 'Báscula de plataforma',
    protocol: 'GENERIC',
    baud_rate: 9600,
    data_bits: 8,
    parity: 'none',
    stop_bits: 1,
    stability_threshold_kg: 5,
    freshness_seconds: 5,
    capacity_kg: 5000,
  },
];

export class FluxarApiClient {
  private baseUrl: string;
  private stationToken: string | null = null;
  private mockMode: boolean;

  constructor(baseUrl: string, mockMode: boolean) {
    this.baseUrl = baseUrl;
    this.mockMode = mockMode;
  }

  setToken(token: string): void {
    this.stationToken = token;
  }

  clearToken(): void {
    this.stationToken = null;
  }

  hasToken(): boolean {
    return this.stationToken !== null;
  }

  // ─── Enrollment ─────────────────────────────────────────────────────────────

  async enroll(enrollmentCode: string, deviceIdentifier: string, appVersion: string): Promise<EnrollResponse> {
    if (this.mockMode) {
      log.info('[API] MOCK enroll — no se llama producción');
      // Simular respuesta exitosa
      return {
        station_token: 'MOCK_TOKEN_NOT_REAL_' + Date.now(),
        station_id: 999,
        station_name: 'Estación Mock',
        branch_name: 'Sucursal Mock',
      };
    }

    log.info('[Enrollment] REQUEST_START');

    const res = await fetch(`${this.baseUrl}/api/scale-agent/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enroll_code: enrollmentCode,
        device_identifier: deviceIdentifier,
        app_version: appVersion,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Enrollment falló: ${res.status} ${body}`);
    }

    log.info('[Enrollment] SUCCESS');
    return res.json() as Promise<EnrollResponse>;
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────────────

  async heartbeat(appVersion: string): Promise<HeartbeatResponse> {
    if (this.mockMode) {
      log.debug('[API] MOCK heartbeat');
      return { ok: true };
    }

    if (!this.stationToken) throw new Error('Sin token de estación');

    const res = await fetch(`${this.baseUrl}/api/scale-agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.stationToken,
      },
      body: JSON.stringify({ app_version: appVersion }),
    });

    if (res.status === 401) throw new Error('UNAUTHORIZED');
    if (!res.ok) throw new Error(`Heartbeat falló: ${res.status}`);

    return res.json() as Promise<HeartbeatResponse>;
  }

  // ─── Get devices ────────────────────────────────────────────────────────────

  async getDevices(): Promise<GetDevicesResponse> {
    if (this.mockMode) {
      log.info('[API] MOCK getDevices');
      return { devices: MOCK_DEVICES };
    }

    if (!this.stationToken) throw new Error('Sin token de estación');

    const res = await fetch(`${this.baseUrl}/api/scale-agent/devices`, {
      headers: { 'Authorization': 'Bearer ' + this.stationToken },
    });

    if (res.status === 401) throw new Error('UNAUTHORIZED');
    if (!res.ok) throw new Error(`getDevices falló: ${res.status}`);

    // El backend devuelve un array directo: [{scale_id, scale_name, com_port, ...}]
    // GetDevicesResponse espera { devices: ScaleDevice[] } con campo canónico `name`.
    // Normalizar aquí: scale_name → name para que AgentService y renderer
    // siempre trabajen con el campo canónico `name` de ScaleDevice.
    const raw = await res.json() as Array<Record<string, unknown>> | GetDevicesResponse;
    const rawArray: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : (raw as GetDevicesResponse).devices as unknown as Array<Record<string, unknown>>;

    const devices: ScaleDevice[] = rawArray.map((d) => ({
      scale_id:               d['scale_id'] as number,
      // Normalización canónica: el backend emite scale_name; ScaleDevice usa name.
      name:                   (d['name'] as string | undefined)
                              ?? (d['scale_name'] as string | undefined)
                              ?? `Báscula #${d['scale_id'] as number}`,
      protocol:               (d['protocol'] as string | undefined) ?? 'GENERIC_TEXT',
      baud_rate:              (d['baud_rate'] as number | undefined) ?? 9600,
      data_bits:              (d['data_bits'] as number | undefined) ?? 8,
      parity:                 (d['parity'] as string | undefined) ?? 'none',
      stop_bits:              (d['stop_bits'] as number | undefined) ?? 1,
      stability_threshold_kg: (d['stability_threshold_kg'] as number | null | undefined) ?? null,
      freshness_seconds:      (d['freshness_seconds'] as number | null | undefined) ?? null,
      capacity_kg:            (d['capacity_kg'] as number | null | undefined) ?? null,
      com_port:               (d['com_port'] as string | null | undefined) ?? null,
    }));

    log.info(`[API] getDevices: ${devices.length} dispositivos normalizados`);
    return { devices };
  }

  // ─── Post readings ───────────────────────────────────────────────────────────

  async postReadings(readings: ScaleReading[]): Promise<PostReadingsResponse> {
    if (this.mockMode) {
      log.debug(`[API] MOCK postReadings — ${readings.length} lecturas (no se envían)`);
      return { accepted: readings.length, rejected: 0 };
    }

    if (!this.stationToken) throw new Error('Sin token de estación');

    const res = await fetch(`${this.baseUrl}/api/scale-agent/readings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.stationToken,
      },
      body: JSON.stringify({ readings }),
    });

    if (res.status === 401) throw new Error('UNAUTHORIZED');
    if (!res.ok) throw new Error(`postReadings falló: ${res.status}`);

    return res.json() as Promise<PostReadingsResponse>;
  }
}

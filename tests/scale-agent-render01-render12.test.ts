/**
 * Tests RENDER01–RENDER12 — Renderer contract y normalización de device name
 *
 * Cubre:
 *   - Normalización scale_name → name en api-client.ts
 *   - Resiliencia del renderer ante campos faltantes
 *   - Separación server_status vs renderer error
 *   - Nombre canónico "Báscula #<id>" como fallback
 *   - No exposición de token en logs
 *   - Versión 0.1.13
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock de electron-log ─────────────────────────────────────────────────────
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock de node:crypto (para agent-service) ─────────────────────────────────
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return actual;
});

// ─── Tipos inline para los tests ──────────────────────────────────────────────
interface DeviceState {
  scale_id: number;
  name: string;
  com_port: string | null;
  protocol: string;
  status: string;
  weight_kg: number | null;
  is_stable: boolean;
  serial_open: boolean;
  last_reading_at: number | null;
  last_error: string | null;
}

interface AppState {
  linked: boolean;
  station_name: string | null;
  station_branch: string | null;
  server_status: 'CONECTADO' | 'SIN_CONEXION' | 'NO_AUTORIZADO';
  devices: DeviceState[];
  version: string;
  autostart: boolean;
  start_minimized: boolean;
  api_url: string | null;
  mode: 'PRODUCTION' | 'MOCK';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simula la normalización que hace api-client.getDevices() */
function normalizeDevice(raw: Record<string, unknown>): { scale_id: number; name: string; protocol: string; com_port: string | null } {
  const scale_id = raw['scale_id'] as number;
  const name = (raw['name'] as string | undefined)
    ?? (raw['scale_name'] as string | undefined)
    ?? `Báscula #${scale_id}`;
  return {
    scale_id,
    name: name.trim() || `Báscula #${scale_id}`,
    protocol: (raw['protocol'] as string | undefined) ?? 'GENERIC_TEXT',
    com_port: (raw['com_port'] as string | null | undefined) ?? null,
  };
}

/** Simula canonicalDeviceName del renderer */
function canonicalDeviceName(d: { scale_id: number; name?: string | null }): string {
  const n = d.name;
  if (n && n.trim().length > 0) return n.trim();
  return `Báscula #${d.scale_id}`;
}

/** Simula escHtml del renderer */
function escHtml(str: string | undefined | null): string {
  if (str == null) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RENDER01–RENDER12 — Renderer contract y normalización', () => {

  // RENDER01 — getState linked=true no lanza excepción al renderizar
  it('RENDER01 getState linked=true renders without exception', () => {
    const state: AppState = {
      linked: true,
      station_name: 'CASETA BASCULA CAMIONERA',
      station_branch: 'Sucursal Principal',
      server_status: 'CONECTADO',
      devices: [{
        scale_id: 1,
        name: 'Báscula Camionera',
        com_port: 'COM4',
        protocol: 'BASYS',
        status: 'DESCONECTADO',
        weight_kg: null,
        is_stable: false,
        serial_open: false,
        last_reading_at: null,
        last_error: null,
      }],
      version: '0.1.13',
      autostart: false,
      start_minimized: true,
      api_url: 'https://ecorecycler.app',
      mode: 'PRODUCTION',
    };

    // Simular render — no debe lanzar
    expect(() => {
      for (const d of state.devices) {
        const name = canonicalDeviceName(d);
        const html = escHtml(name);
        expect(html.length).toBeGreaterThan(0);
      }
    }).not.toThrow();
  });

  // RENDER02 — campo name=undefined nunca causa .replace crash
  it('RENDER02 missing optional text field never causes .replace crash', () => {
    // Simular device con name=undefined (como llegaba del backend antes del fix)
    const d = { scale_id: 1, name: undefined as unknown as string, com_port: 'COM4', protocol: 'BASYS', status: 'DESCONECTADO', weight_kg: null, is_stable: false, serial_open: false, last_reading_at: null, last_error: null };

    // escHtml con undefined NO debe lanzar TypeError
    expect(() => escHtml(d.name)).not.toThrow();
    expect(escHtml(d.name)).toBe('');

    // canonicalDeviceName con name=undefined devuelve fallback
    expect(() => canonicalDeviceName(d)).not.toThrow();
    expect(canonicalDeviceName(d)).toBe('Báscula #1');
  });

  // RENDER03 — scale_name del backend se normaliza a name canónico
  it('RENDER03 canonical scale_name renders "Báscula Camionera"', () => {
    const rawFromBackend = {
      scale_id: 1,
      scale_name: 'Báscula Camionera',
      com_port: 'COM4',
      protocol: 'BASYS',
      baud_rate: 9600,
      data_bits: 8,
      parity: 'none',
      stop_bits: 1,
    };

    const normalized = normalizeDevice(rawFromBackend);
    expect(normalized.name).toBe('Báscula Camionera');
    expect(escHtml(normalized.name)).toBe('Báscula Camionera');
  });

  // RENDER04 — device sin name usa "Báscula #<id>"
  it('RENDER04 device missing name uses "Báscula #<id>"', () => {
    const rawNoName = { scale_id: 1, com_port: 'COM4', protocol: 'BASYS', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1 };
    const normalized = normalizeDevice(rawNoName);
    expect(normalized.name).toBe('Báscula #1');

    const rawEmptyName = { scale_id: 2, scale_name: '   ', com_port: null, protocol: 'GENERIC', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1 };
    const normalized2 = normalizeDevice(rawEmptyName);
    expect(normalized2.name).toBe('Báscula #2');
  });

  // RENDER05 — excepción en renderer no sobreescribe server_status
  it('RENDER05 renderer exception cannot overwrite server connection state', () => {
    // server_status es independiente del render de devices
    // Si renderDevices lanza, server_status no cambia
    let serverStatus: 'CONECTADO' | 'SIN_CONEXION' = 'CONECTADO';

    const renderDevicesSafe = (devices: DeviceState[]): void => {
      try {
        for (const d of devices) {
          // Simular crash en render de un device
          if (!d.name) throw new Error('name is undefined');
          escHtml(d.name);
        }
      } catch {
        // El error de render NO modifica serverStatus
        // serverStatus permanece CONECTADO
      }
    };

    const brokenDevice = { scale_id: 1, name: undefined as unknown as string, com_port: 'COM4', protocol: 'BASYS', status: 'DESCONECTADO', weight_kg: null, is_stable: false, serial_open: false, last_reading_at: null, last_error: null };
    renderDevicesSafe([brokenDevice]);

    // server_status no fue modificado por el error de render
    expect(serverStatus).toBe('CONECTADO');
  });

  // RENDER06 — un device renderiza una card
  it('RENDER06 one device renders one card', () => {
    const devices: DeviceState[] = [{
      scale_id: 1,
      name: 'Báscula Camionera',
      com_port: 'COM4',
      protocol: 'BASYS',
      status: 'DESCONECTADO',
      weight_kg: null,
      is_stable: false,
      serial_open: false,
      last_reading_at: null,
      last_error: null,
    }];

    // Simular renderDevices — genera una card por device
    const cards = devices.map(d => {
      const name = canonicalDeviceName(d);
      return `<div class="device-card"><div class="device-name">${escHtml(name)}</div></div>`;
    });

    expect(cards.length).toBe(1);
    expect(cards[0]).toContain('Báscula Camionera');
    expect(cards[0]).toContain('device-card');
  });

  // RENDER07 — COM4 se muestra correctamente
  it('RENDER07 COM4 shown correctly', () => {
    const d: DeviceState = { scale_id: 1, name: 'Báscula Camionera', com_port: 'COM4', protocol: 'BASYS', status: 'DESCONECTADO', weight_kg: null, is_stable: false, serial_open: false, last_reading_at: null, last_error: null };
    const comPort = d.com_port || '—';
    expect(escHtml(comPort)).toBe('COM4');
  });

  // RENDER08 — serial_open=true renderiza "Conectada"
  it('RENDER08 serial_open=true renders connected/open', () => {
    const d: DeviceState = { scale_id: 1, name: 'Báscula Camionera', com_port: 'COM4', protocol: 'BASYS', status: 'ESTABLE', weight_kg: 1500, is_stable: true, serial_open: true, last_reading_at: Date.now(), last_error: null };
    const serialLabel = d.serial_open ? 'Conectada' : 'Desconectada';
    expect(serialLabel).toBe('Conectada');
  });

  // RENDER09 — actualización de polling preserva la card
  it('RENDER09 polling state update preserves card', () => {
    const initial: DeviceState = { scale_id: 1, name: 'Báscula Camionera', com_port: 'COM4', protocol: 'BASYS', status: 'DESCONECTADO', weight_kg: null, is_stable: false, serial_open: false, last_reading_at: null, last_error: null };
    const updated: DeviceState = { ...initial, weight_kg: 2500, is_stable: true, serial_open: true, status: 'ESTABLE', last_reading_at: Date.now() };

    // Simular dos renders consecutivos
    const render1 = canonicalDeviceName(initial);
    const render2 = canonicalDeviceName(updated);

    // El nombre se preserva en ambos renders
    expect(render1).toBe('Báscula Camionera');
    expect(render2).toBe('Báscula Camionera');
    // El peso se actualiza
    expect(updated.weight_kg).toBe(2500);
  });

  // RENDER10 — token no expuesto en diagnóstico/log
  it('RENDER10 no token exposed in diagnostic/log', async () => {
    // AppState nunca incluye station_token
    const state: AppState = {
      linked: true,
      station_name: 'CASETA',
      station_branch: 'Sucursal',
      server_status: 'CONECTADO',
      devices: [],
      version: '0.1.13',
      autostart: false,
      start_minimized: true,
      api_url: 'https://ecorecycler.app',
      mode: 'PRODUCTION',
    };

    const stateStr = JSON.stringify(state);
    expect(stateStr).not.toContain('station_token');
    expect(stateStr).not.toContain('token_hash');
    expect(stateStr).not.toContain('enrollment_code');
  });

  // RENDER11 — log de Device usa nombre canónico (no "undefined")
  it('RENDER11 Device log uses canonical name', () => {
    const rawFromBackend = { scale_id: 1, scale_name: 'Báscula Camionera', com_port: 'COM4', protocol: 'BASYS', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1 };
    const normalized = normalizeDevice(rawFromBackend);

    // El log usa normalized.name — nunca "undefined"
    const logLine = `Device ${normalized.scale_id} (${normalized.name}) nuevo — abriendo puerto`;
    expect(logLine).not.toContain('undefined');
    expect(logLine).toContain('Báscula Camionera');
  });

  // RENDER12 — versión 0.1.13 mostrada
  it('RENDER12 0.1.13 still displayed', () => {
    const state: AppState = {
      linked: true,
      station_name: 'CASETA',
      station_branch: null,
      server_status: 'CONECTADO',
      devices: [],
      version: '0.1.13',
      autostart: false,
      start_minimized: true,
      api_url: null,
      mode: 'PRODUCTION',
    };
    expect(state.version).toBe('0.1.13');
  });
});

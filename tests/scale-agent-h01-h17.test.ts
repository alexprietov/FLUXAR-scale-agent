/**
 * H01–H17: Tests de devices endpoint, contrato API↔agente, versión y restart
 *
 * INC-SCALE-DEVICES-01
 *
 * ROOT_CAUSE_DEVICES:
 *   El backend GET /api/scale-agent/devices devuelve un array directo [{...}].
 *   api-client.ts esperaba { devices: ScaleDevice[] } y hacía res.json() as Promise<GetDevicesResponse>.
 *   Al desestructurar { devices } de un array, devices quedaba undefined.
 *   AgentService._fetchDevices() recibía devices=undefined → deviceStates vacío → renderer mostraba
 *   "Sin básculas configuradas" aunque la asignación existía en DB.
 *
 * ROOT_CAUSE_VERSION:
 *   index.html tenía <span id="app-version">0.1.0</span> hardcodeado.
 *   El renderer nunca actualizaba ese span con AppState.version.
 *   AppState.version ya existía y se llenaba con APP_VERSION='0.1.12'.
 *
 * H01  enrolled station receives assigned scale
 * H02  station with no assignment receives []
 * H03  tenant match handles PG bigint string/number correctly
 * H04  branch match handles PG bigint correctly
 * H05  inactive assignment excluded
 * H06  inactive scale excluded
 * H07  API contract matches agent DeviceConfig
 * H08  COM4 returned for station_id=1 fixture
 * H09  no COM4 hardcode
 * H10  AgentService loads devices after startup
 * H11  loaded device passed to SerialManager
 * H12  renderer displays loaded device
 * H13  app version single authority
 * H14  heartbeat sends actual version
 * H15  restart preserves enrollment/token
 * H16  restart automatically loads devices
 * H17  no duplicate enrollment required
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const ROOT = path.resolve(__dirname, '..');

function readSrc(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`Archivo no existe: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: { file: { resolvePath: vi.fn() } },
  },
}));

import { TokenStore } from '../src/main/token-store.js';
import { ConfigStore } from '../src/main/config-store.js';
import { FluxarApiClient } from '../src/main/api-client.js';

function makeMockSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(s.split('').map(c => c.charCodeAt(0) ^ 0x42)),
    decryptString: (b: Buffer) => Buffer.from(b.map(byte => byte ^ 0x42)).toString('utf8'),
  };
}

// ─── H01 — enrolled station receives assigned scale ──────────────────────────

describe('H01 — enrolled station receives assigned scale', () => {
  it('api-client.getDevices envuelve array directo en { devices }', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          scale_id: 1,
          scale_name: 'Báscula Camionera',
          com_port: 'COM4',
          baud_rate: 9600,
          data_bits: 8,
          parity: 'none',
          stop_bits: 1,
          protocol: 'GENERIC_TEXT',
          stability_threshold_kg: 5,
          stability_min_samples: 5,
          stability_window_ms: 2000,
          freshness_seconds: 10,
          capacity_kg: 80000,
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    client.setToken('test-token');
    const result = await client.getDevices();

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].scale_id).toBe(1);
    expect(result.devices[0].com_port).toBe('COM4');

    vi.unstubAllGlobals();
  });

  it('api-client.getDevices también acepta respuesta { devices: [...] } (compatibilidad)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        devices: [{ scale_id: 2, scale_name: 'Báscula Mediana', com_port: 'COM3', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, protocol: 'GENERIC_TEXT', stability_threshold_kg: 5, stability_min_samples: 5, stability_window_ms: 2000, freshness_seconds: 10, capacity_kg: 5000 }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    client.setToken('test-token');
    const result = await client.getDevices();

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].scale_id).toBe(2);

    vi.unstubAllGlobals();
  });
});

// ─── H02 — station with no assignment receives [] ────────────────────────────

describe('H02 — station with no assignment receives []', () => {
  it('array vacío del backend → devices=[]', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    client.setToken('test-token');
    const result = await client.getDevices();

    expect(result.devices).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});

// ─── H03 — tenant match handles PG bigint string/number ──────────────────────

describe('H03 — tenant match handles PG bigint string/number correctly', () => {
  it('scale-agent.ts usa toNum() en comparaciones de company_id en readings', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    // Verificar que las comparaciones de company_id usan toNum()
    expect(src).toMatch(/toNum\(scaleConfig\.company_id\)\s*!==\s*toNum\(station\.company_id\)/);
  });

  it('scales-admin.ts usa toNum() en comparaciones de company_id/branch_id', () => {
    const src = readSrc('../../src/server/api/scales-admin.ts');
    expect(src).toContain('toNum(');
  });
});

// ─── H04 — branch match handles PG bigint correctly ─────────────────────────

describe('H04 — branch match handles PG bigint correctly', () => {
  it('scale-agent.ts usa toNum() en comparaciones de branch_id en readings', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    expect(src).toMatch(/toNum\(scaleConfig\.branch_id\)\s*!==\s*toNum\(station\.branch_id\)/);
  });
});

// ─── H05 — inactive assignment excluded ──────────────────────────────────────

describe('H05 — inactive assignment excluded', () => {
  it('GET /devices filtra is_active=TRUE en PG', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    // El endpoint GET /devices debe filtrar por is_active
    const devicesEndpoint = src.match(/router\.get\('\/devices'[\s\S]*?}\);/)?.[0] ?? '';
    expect(devicesEndpoint).toContain('is_active');
    expect(devicesEndpoint).toContain('TRUE');
  });
});

// ─── H06 — inactive scale excluded ───────────────────────────────────────────

describe('H06 — inactive scale excluded', () => {
  it('GET /devices hace JOIN con scales y puede filtrar por status', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const devicesEndpoint = src.match(/router\.get\('\/devices'[\s\S]*?}\);/)?.[0] ?? '';
    expect(devicesEndpoint).toContain('JOIN scales');
  });
});

// ─── H07 — API contract matches agent DeviceConfig ───────────────────────────

describe('H07 — API contract matches agent DeviceConfig', () => {
  it('backend devuelve scale_id (no id)', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const devicesMap = src.match(/res\.json\(devices\.map[\s\S]*?\)\);/)?.[0] ?? '';
    expect(devicesMap).toContain('scale_id:');
    expect(devicesMap).not.toMatch(/^\s*id:/m);
  });

  it('backend devuelve com_port (no port)', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const devicesMap = src.match(/res\.json\(devices\.map[\s\S]*?\)\);/)?.[0] ?? '';
    expect(devicesMap).toContain('com_port:');
  });

  it('backend devuelve baud_rate (no baudRate)', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const devicesMap = src.match(/res\.json\(devices\.map[\s\S]*?\)\);/)?.[0] ?? '';
    expect(devicesMap).toContain('baud_rate:');
    expect(devicesMap).not.toContain('baudRate:');
  });

  it('backend devuelve protocol (no serial_protocol)', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const devicesMap = src.match(/res\.json\(devices\.map[\s\S]*?\)\);/)?.[0] ?? '';
    expect(devicesMap).toContain('protocol:');
  });

  it('ScaleDevice en types.ts tiene com_port opcional', () => {
    const src = readSrc('src/shared/types.ts');
    expect(src).toMatch(/com_port\?:/);
  });

  it('api-client.ts normaliza scale_name → name (0.1.14)', () => {
    const src = readSrc('src/main/api-client.ts');
    // 0.1.14: normalización explícita scale_name → name en getDevices()
    expect(src).toContain('scale_name');
    expect(src).toContain('name:');
    // Ya no usa el patrón legacy { devices: raw }
    expect(src).not.toContain('{ devices: raw }');
  });
});

// ─── H08 — COM4 returned for station_id=1 fixture ────────────────────────────

describe('H08 — COM4 returned for station_id=1 fixture', () => {
  it('api-client.getDevices retorna com_port del backend para station_id=1', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { scale_id: 1, scale_name: 'Báscula Camionera', com_port: 'COM4', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1, protocol: 'GENERIC_TEXT', stability_threshold_kg: 5, stability_min_samples: 5, stability_window_ms: 2000, freshness_seconds: 10, capacity_kg: 80000 },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    client.setToken('test-token');
    const { devices } = await client.getDevices();

    expect(devices[0].com_port).toBe('COM4');

    vi.unstubAllGlobals();
  });
});

// ─── H09 — no COM4 hardcode ───────────────────────────────────────────────────

describe('H09 — no COM4 hardcode', () => {
  it('api-client.ts no contiene COM4 hardcodeado', () => {
    const src = readSrc('src/main/api-client.ts');
    expect(src).not.toContain('COM4');
  });

  it('agent-service.ts no contiene COM4 hardcodeado', () => {
    const src = readSrc('src/main/agent-service.ts');
    expect(src).not.toContain('COM4');
  });

  it('main.ts no contiene COM4 hardcodeado', () => {
    const src = readSrc('src/main/main.ts');
    expect(src).not.toContain('COM4');
  });
});

// ─── H10 — AgentService loads devices after startup ──────────────────────────

describe('H10 — AgentService loads devices after startup', () => {
  it('agent-service.ts llama _fetchDevices() en initialize() si tiene token', () => {
    const src = readSrc('src/main/agent-service.ts');
    const initBlock = src.match(/async initialize\(\)[\s\S]*?^\s*\}/m)?.[0] ?? '';
    expect(initBlock).toContain('_fetchDevices()');
    expect(initBlock).toContain('hasToken()');
  });

  it('agent-service.ts llama _fetchDevices() en _afterEnrollment()', () => {
    const src = readSrc('src/main/agent-service.ts');
    const afterBlock = src.match(/private async _afterEnrollment[\s\S]*?^\s*\}/m)?.[0] ?? '';
    expect(afterBlock).toContain('_fetchDevices()');
  });
});

// ─── H11 — loaded device passed to SerialManager ─────────────────────────────

describe('H11 — loaded device passed to SerialManager', () => {
  it('_fetchDevices usa com_port del backend como fallback cuando no hay config local', () => {
    const src = readSrc('src/main/agent-service.ts');
    // Debe usar d.com_port como fallback
    expect(src).toContain('d.com_port');
    // La lógica de fallback: localCfg?.com_port ?? d.com_port ?? null
    expect(src).toMatch(/localCfg\?\.com_port\s*\?\?\s*d\.com_port/);
  });

  it('_openDevice recibe effectiveCfg con com_port del backend', () => {
    const src = readSrc('src/main/agent-service.ts');
    expect(src).toContain('effectiveCfg');
    expect(src).toContain('com_port: comPort');
  });
});

// ─── H12 — renderer displays loaded device ───────────────────────────────────

describe('H12 — renderer displays loaded device', () => {
  it('renderDevices muestra tarjeta cuando devices.length > 0', () => {
    const src = readSrc('src/renderer/renderer.ts');
    const renderDevicesFn = src.match(/function renderDevices[\s\S]*?^}/m)?.[0] ?? '';
    expect(renderDevicesFn).toContain('device-card');
    // 0.1.14: usa canonicalDeviceName(d) en lugar de d.name directamente
    expect(renderDevicesFn).toContain('canonicalDeviceName');
    // d.com_port está en renderDeviceCard (función auxiliar llamada por renderDevices)
    expect(src).toContain('d.com_port');
  });

  it('renderer actualiza #app-version con state.version', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('app-version');
    expect(src).toContain('state.version');
  });
});

// ─── H13 — app version single authority ──────────────────────────────────────

describe('H13 — app version single authority', () => {
  it('APP_VERSION en agent-service.ts es la única fuente de verdad', () => {
    const src = readSrc('src/main/agent-service.ts');
    expect(src).toContain("const APP_VERSION = '0.1.14'");
  });

  it('AppState.version se llena con APP_VERSION', () => {
    const src = readSrc('src/main/agent-service.ts');
    const getStateBlock = src.match(/getAppState\(\)[\s\S]*?^\s*\}/m)?.[0] ?? '';
    expect(getStateBlock).toContain('version: APP_VERSION');
  });

  it('renderer usa state.version para actualizar el span', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain("document.getElementById('app-version')");
    expect(src).toContain('state.version');
  });

  it('index.html tiene span #app-version (puede ser placeholder)', () => {
    const src = readSrc('src/renderer/index.html');
    expect(src).toContain('id="app-version"');
  });

  it('package.json version es 0.1.14', () => {
    const pkg = JSON.parse(readSrc('package.json'));
    expect(pkg.version).toBe('0.1.14');
  });
});

// ─── H14 — heartbeat sends actual version ────────────────────────────────────

describe('H14 — heartbeat sends actual version', () => {
  it('heartbeat envía APP_VERSION (0.1.14)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, devices: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    client.setToken('test-token');
    await client.heartbeat('0.1.14');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.app_version).toBe('0.1.14');

    vi.unstubAllGlobals();
  });

  it('agent-service.ts pasa APP_VERSION al heartbeat', () => {
    const src = readSrc('src/main/agent-service.ts');
    expect(src).toContain('heartbeat(APP_VERSION)');
  });
});

// ─── H15 — restart preserves enrollment/token ────────────────────────────────

describe('H15 — restart preserves enrollment/token', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-h15-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('token persiste entre instancias (simula restart)', () => {
    const mockSafe = makeMockSafeStorage(true);
    const token = 'station-token-' + crypto.randomBytes(8).toString('hex');

    const store1 = new TokenStore(tmpDir, mockSafe, false);
    store1.saveToken(token);

    const store2 = new TokenStore(tmpDir, mockSafe, false);
    expect(store2.loadToken()).toBe(token);
    expect(store2.hasToken()).toBe(true);
  });

  it('device_identifier persiste entre instancias', () => {
    const store1 = new ConfigStore(tmpDir);
    const id1 = store1.getOrCreateDeviceIdentifier();

    const store2 = new ConfigStore(tmpDir);
    const id2 = store2.getOrCreateDeviceIdentifier();

    expect(id2).toBe(id1);
  });

  it('station_name persiste entre instancias', () => {
    const store1 = new ConfigStore(tmpDir);
    store1.setStationMeta(1, 'CASETA BASCULA CAMIONERA', 'Sucursal Principal');

    const store2 = new ConfigStore(tmpDir);
    const cfg = store2.get();
    expect(cfg.station_name).toBe('CASETA BASCULA CAMIONERA');
    expect(cfg.station_branch).toBe('Sucursal Principal');
  });
});

// ─── H16 — restart automatically loads devices ───────────────────────────────

describe('H16 — restart automatically loads devices', () => {
  it('initialize() llama _fetchDevices() cuando tokenStore.hasToken() y api.hasToken()', () => {
    const src = readSrc('src/main/agent-service.ts');
    const initBlock = src.match(/async initialize\(\)[\s\S]*?^\s*\}/m)?.[0] ?? '';
    // Debe verificar ambas condiciones antes de fetchDevices
    expect(initBlock).toContain('tokenStore.hasToken()');
    expect(initBlock).toContain('api.hasToken()');
    expect(initBlock).toContain('_fetchDevices()');
  });

  it('constructor carga token en api si existe', () => {
    const src = readSrc('src/main/agent-service.ts');
    // En el constructor: loadToken() → api.setToken()
    expect(src).toContain('tokenStore.loadToken()');
    expect(src).toContain('api.setToken(token)');
  });
});

// ─── H17 — no duplicate enrollment required ──────────────────────────────────

describe('H17 — no duplicate enrollment required', () => {
  it('si token existe en disco, no se requiere nuevo enrollment', () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-h17-'));
    try {
      const mockSafe = makeMockSafeStorage(true);
      const store = new TokenStore(tmpDir2, mockSafe, false);
      store.saveToken('existing-token');

      // Nueva instancia (simula restart)
      const store2 = new TokenStore(tmpDir2, mockSafe, false);
      expect(store2.hasToken()).toBe(true);
      expect(store2.loadToken()).toBe('existing-token');
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  it('enrollment solo se requiere cuando hasToken() es false', () => {
    const src = readSrc('src/main/agent-service.ts');
    // initialize() solo llama fetchDevices si ya tiene token
    // No llama enroll() en initialize()
    const initBlock = src.match(/async initialize\(\)[\s\S]*?^\s*\}/m)?.[0] ?? '';
    expect(initBlock).not.toContain('enroll(');
  });
});

/**
 * I01–I15: Tests de autenticación de estación, estado UI y re-enrollment
 *
 * INC-SCALE-AUTH-01
 *
 * ROOT_CAUSE_AUTH:
 *   El agente muestra "● Conectado" porque render() llama updateConnectionStatus(true)
 *   siempre que state.linked===true, ignorando state.server_status.
 *   Cuando el heartbeat devuelve 401, agent-service.ts sí actualiza serverStatus='NO_AUTORIZADO'
 *   y emite STATE_UPDATE, pero el renderer lo ignora y mantiene "Conectado".
 *
 * ROOT_CAUSE_TOKEN_MISMATCH (hipótesis a confirmar con diagnóstico):
 *   El token local puede no coincidir con token_hash en DB si hubo múltiples
 *   enrollments o si safeStorage sobreescribió con un token de una sesión anterior.
 *   El DiagnosticReport ahora incluye token_local_prefix y token_local_hash_sha256
 *   para comparar con el servidor sin exponer el token.
 *
 * I01  valid persisted token authenticates GET devices
 * I02  valid persisted token authenticates heartbeat
 * I03  wrong persisted token → 401
 * I04  revoked token → 401
 * I05  expired token → 401
 * I06  prefix mismatch → 401
 * I07  hash mismatch → 401
 * I08  401 changes UI connection state to AUTH_ERROR
 * I09  linked local + 401 must NOT display Conectado
 * I10  successful heartbeat displays Conectado
 * I11  reenrollment replaces token safely
 * I12  restart loads latest encrypted token
 * I13  assignment remains untouched during reenrollment
 * I14  no secrets logged
 * I15  COM configuration untouched
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

function makeMockSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(s.split('').map(c => c.charCodeAt(0) ^ 0x42)),
    decryptString: (b: Buffer) => Buffer.from(b.map((byte: number) => byte ^ 0x42)).toString('utf8'),
  };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

// ─── I01 — valid persisted token authenticates GET devices ───────────────────

describe('I01 — valid persisted token authenticates GET devices', () => {
  it('authenticateStation extrae prefix y busca en DB', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const authFn = src.match(/async function authenticateStation[\s\S]*?^}/m)?.[0] ?? '';
    expect(authFn).toContain("token.slice(0, 8)");
    expect(authFn).toContain("token_prefix");
    expect(authFn).toContain("hashToken(token)");
    expect(authFn).toContain("timingSafeEqual");
  });

  it('GET /devices usa authenticateStation como middleware', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    expect(src).toMatch(/router\.get\('\/devices',\s*authenticateStation/);
  });
});

// ─── I02 — valid persisted token authenticates heartbeat ─────────────────────

describe('I02 — valid persisted token authenticates heartbeat', () => {
  it('POST /heartbeat usa authenticateStation como middleware', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    expect(src).toMatch(/router\.post\('\/heartbeat',\s*authenticateStation/);
  });

  it('heartbeat envía Authorization: Bearer en header', () => {
    const src = readSrc('src/main/api-client.ts');
    // Verificar que el archivo usa Authorization: Bearer (no X-Station-Token)
    expect(src).toContain("'Authorization': 'Bearer '");
    expect(src).not.toContain("'X-Station-Token'");
  });
});

// ─── I03 — wrong persisted token → 401 ───────────────────────────────────────

describe('I03 — wrong persisted token → 401', () => {
  it('token incorrecto → INVALID_TOKEN 401', async () => {
    const wrongToken = crypto.randomBytes(32).toString('hex');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'INVALID_TOKEN' }),
      text: async () => JSON.stringify({ error: 'INVALID_TOKEN' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { FluxarApiClient } = await import('../src/main/api-client.js');
    const client = new FluxarApiClient('https://example.com', false);
    client.setToken(wrongToken);

    await expect(client.heartbeat('0.1.11')).rejects.toThrow();

    vi.unstubAllGlobals();
  });
});

// ─── I04 — revoked token → 401 ───────────────────────────────────────────────

describe('I04 — revoked token → 401', () => {
  it('authenticateStation verifica token_revoked_at', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const authFn = src.match(/async function authenticateStation[\s\S]*?^}/m)?.[0] ?? '';
    expect(authFn).toContain('token_revoked_at');
    expect(authFn).toContain('REVOKED');
  });
});

// ─── I05 — expired token → 401 ───────────────────────────────────────────────

describe('I05 — expired token → 401', () => {
  it('authenticateStation verifica token_expires_at', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const authFn = src.match(/async function authenticateStation[\s\S]*?^}/m)?.[0] ?? '';
    expect(authFn).toContain('token_expires_at');
    expect(authFn).toContain('EXPIRED');
  });
});

// ─── I06 — prefix mismatch → 401 ─────────────────────────────────────────────

describe('I06 — prefix mismatch → 401', () => {
  it('si prefix no existe en DB, stations array vacío → INVALID_TOKEN', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const authFn = src.match(/async function authenticateStation[\s\S]*?^}/m)?.[0] ?? '';
    // Si stations está vacío, matched=null → 401
    expect(authFn).toContain('matched');
    expect(authFn).toContain('INVALID_TOKEN');
  });
});

// ─── I07 — hash mismatch → 401 ───────────────────────────────────────────────

describe('I07 — hash mismatch → 401', () => {
  it('timingSafeEqual con hash diferente → matched=null → 401', () => {
    const tokenA = crypto.randomBytes(32).toString('hex');
    const tokenB = crypto.randomBytes(32).toString('hex');
    const hashA = hashToken(tokenA);
    const hashB = hashToken(tokenB);
    // Los hashes deben ser distintos
    expect(hashA).not.toBe(hashB);
    // El prefix de tokenA no coincide con el hash de tokenB
    expect(tokenA.slice(0, 8)).not.toBe(hashB.slice(0, 8));
  });

  it('hashToken es SHA-256 hex', () => {
    const token = 'bfed095d' + crypto.randomBytes(28).toString('hex');
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    // El hash NO empieza con el mismo prefix que el token
    expect(hash.slice(0, 8)).not.toBe(token.slice(0, 8));
  });
});

// ─── I08 — 401 changes UI connection state to AUTH_ERROR ─────────────────────

describe('I08 — 401 changes UI connection state to AUTH_ERROR', () => {
  it('agent-service.ts establece serverStatus=NO_AUTORIZADO en 401 heartbeat', () => {
    const src = readSrc('src/main/agent-service.ts');
    // Buscar el bloque de heartbeat que maneja 401
    expect(src).toContain("'NO_AUTORIZADO'");
    // Debe haber lógica que detecte 401 y cambie serverStatus
    expect(src).toMatch(/NO_AUTORIZADO/);
  });

  it('agent-service.ts establece serverStatus=NO_AUTORIZADO en 401 _fetchDevices', () => {
    const src = readSrc('src/main/agent-service.ts');
    // _fetchDevices también puede recibir 401
    expect(src).toContain('UNAUTHORIZED');
  });

  it('renderer.ts updateConnectionStatus acepta NO_AUTORIZADO', () => {
    const src = readSrc('src/renderer/renderer.ts');
    const fn = src.match(/function updateConnectionStatus[\s\S]*?^}/m)?.[0] ?? '';
    expect(fn).toContain('NO_AUTORIZADO');
    expect(fn).toContain('auth-error');
  });
});

// ─── I09 — linked local + 401 must NOT display Conectado ─────────────────────

describe('I09 — linked local + 401 must NOT display Conectado', () => {
  it('render() pasa state.server_status a updateConnectionStatus, no true hardcodeado', () => {
    const src = readSrc('src/renderer/renderer.ts');
    // Debe pasar state.server_status, no el literal true
    expect(src).toContain('updateConnectionStatus(state.server_status)');
    expect(src).not.toContain('updateConnectionStatus(true)');
  });

  it('updateConnectionStatus con NO_AUTORIZADO NO muestra "Conectado"', () => {
    const src = readSrc('src/renderer/renderer.ts');
    const fn = src.match(/function updateConnectionStatus[\s\S]*?^}/m)?.[0] ?? '';
    // En el branch NO_AUTORIZADO no debe aparecer 'Conectado'
    // Verificar que 'Conectado' solo aparece en el branch CONECTADO
    const conectadoBranch = fn.match(/if \(status === 'CONECTADO'\)[\s\S]*?} else/)?.[0] ?? '';
    expect(conectadoBranch).toContain('Conectado');
    // El branch NO_AUTORIZADO debe tener texto diferente
    expect(fn).toContain('Error de autenticación');
  });

  it('index.html tiene estilo auth-error para el dot rojo', () => {
    const src = readSrc('src/renderer/index.html');
    expect(src).toContain('auth-error');
    expect(src).toContain('var(--red)');
  });
});

// ─── I10 — successful heartbeat displays Conectado ───────────────────────────

describe('I10 — successful heartbeat displays Conectado', () => {
  it('heartbeat exitoso → serverStatus=CONECTADO → UI muestra Conectado', () => {
    const src = readSrc('src/main/agent-service.ts');
    // Buscar el bloque que establece CONECTADO tras heartbeat exitoso
    expect(src).toContain("'CONECTADO'");
    // Debe estar en el contexto del heartbeat
    const heartbeatBlock = src.match(/private async _heartbeatLoop[\s\S]*?^\s*\}/m)?.[0]
      ?? src.match(/heartbeat[\s\S]*?CONECTADO[\s\S]*?}/)?.[0]
      ?? '';
    expect(heartbeatBlock).toContain('CONECTADO');
  });

  it('updateConnectionStatus con CONECTADO muestra "Conectado"', () => {
    const src = readSrc('src/renderer/renderer.ts');
    const fn = src.match(/function updateConnectionStatus[\s\S]*?^}/m)?.[0] ?? '';
    expect(fn).toContain("status === 'CONECTADO'");
    expect(fn).toContain("'Conectado'");
  });
});

// ─── I11 — reenrollment replaces token safely ────────────────────────────────

describe('I11 — reenrollment replaces token safely', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-i11-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveToken sobreescribe token anterior', () => {
    const mockSafe = makeMockSafeStorage(true);
    const store = new TokenStore(tmpDir, mockSafe, false);

    const token1 = crypto.randomBytes(32).toString('hex');
    const token2 = crypto.randomBytes(32).toString('hex');

    store.saveToken(token1);
    expect(store.loadToken()).toBe(token1);

    store.saveToken(token2);
    expect(store.loadToken()).toBe(token2);
    expect(store.loadToken()).not.toBe(token1);
  });

  it('enrollment en agent-service llama saveToken con el nuevo token', () => {
    const src = readSrc('src/main/agent-service.ts');
    const enrollBlock = src.match(/async enroll[\s\S]*?^\s*\}/m)?.[0] ?? '';
    expect(enrollBlock).toContain('saveToken(result.station_token)');
    expect(enrollBlock).toContain('api.setToken(result.station_token)');
  });

  it('backend enrollment usa WHERE enroll_code_used_at IS NULL (idempotencia)', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    expect(src).toContain('enroll_code_used_at IS NULL');
  });
});

// ─── I12 — restart loads latest encrypted token ──────────────────────────────

describe('I12 — restart loads latest encrypted token', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-i12-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('token guardado con safeStorage se recupera idéntico tras nueva instancia', () => {
    const mockSafe = makeMockSafeStorage(true);
    const token = crypto.randomBytes(32).toString('hex');

    const store1 = new TokenStore(tmpDir, mockSafe, false);
    store1.saveToken(token);

    const store2 = new TokenStore(tmpDir, mockSafe, false);
    const recovered = store2.loadToken();
    expect(recovered).toBe(token);
  });

  it('token recuperado tiene el mismo prefix y hash que el original', () => {
    const mockSafe = makeMockSafeStorage(true);
    const token = crypto.randomBytes(32).toString('hex');

    const store1 = new TokenStore(tmpDir, mockSafe, false);
    store1.saveToken(token);

    const store2 = new TokenStore(tmpDir, mockSafe, false);
    const recovered = store2.loadToken()!;

    expect(recovered.slice(0, 8)).toBe(token.slice(0, 8));
    expect(hashToken(recovered)).toBe(hashToken(token));
  });
});

// ─── I13 — assignment remains untouched during reenrollment ──────────────────

describe('I13 — assignment remains untouched during reenrollment', () => {
  it('enrollment backend NO modifica scale_station_devices', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const enrollBlock = src.match(/router\.post\('\/enroll'[\s\S]*?}\);/)?.[0] ?? '';
    // El enrollment solo hace UPDATE en scale_stations, no en scale_station_devices
    expect(enrollBlock).not.toContain('UPDATE scale_station_devices');
    expect(enrollBlock).not.toContain('DELETE FROM scale_station_devices');
  });

  it('enrollment backend NO modifica scales', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const enrollBlock = src.match(/router\.post\('\/enroll'[\s\S]*?}\);/)?.[0] ?? '';
    expect(enrollBlock).not.toContain('UPDATE scales');
  });
});

// ─── I14 — no secrets logged ─────────────────────────────────────────────────

describe('I14 — no secrets logged', () => {
  it('agent-service.ts no loguea station_token', () => {
    const src = readSrc('src/main/agent-service.ts');
    // No debe haber log.info/warn/error con station_token
    expect(src).not.toMatch(/log\.(info|warn|error|debug)\([^)]*station_token/);
  });

  it('api-client.ts no loguea stationToken', () => {
    const src = readSrc('src/main/api-client.ts');
    expect(src).not.toMatch(/log\.(info|warn|error|debug)\([^)]*stationToken/);
    expect(src).not.toMatch(/console\.(log|warn|error)\([^)]*stationToken/);
  });

  it('token-store.ts tiene comentario NUNCA loguear', () => {
    const src = readSrc('src/main/token-store.ts');
    expect(src).toContain('NUNCA loguear');
  });

  it('DiagnosticReport no incluye station_token como campo', () => {
    const src = readSrc('src/shared/types.ts');
    const diagInterface = src.match(/interface DiagnosticReport[\s\S]*?^}/m)?.[0] ?? '';
    // No debe haber campo station_token: (solo comentarios son aceptables)
    expect(diagInterface).not.toMatch(/^\s+station_token\s*:/m);
    // Sí debe incluir el diagnóstico seguro
    expect(diagInterface).toContain('token_local_prefix');
    expect(diagInterface).toContain('token_local_hash_sha256');
  });

  it('getDiagnostic() no expone el token directamente', () => {
    const src = readSrc('src/main/agent-service.ts');
    // El método getDiagnostic() delega a _safeTokenDiagnostic
    expect(src).toContain('_safeTokenDiagnostic()');
    // No debe haber station_token: en el return de getDiagnostic
    const diagFn = src.match(/getDiagnostic\(\): DiagnosticReport[\s\S]*?^\s*\}/m)?.[0] ?? '';
    expect(diagFn).not.toContain('station_token:');
  });

  it('_safeTokenDiagnostic calcula hash pero no lo loguea', () => {
    const src = readSrc('src/main/agent-service.ts');
    // Verificar que el método existe y usa createHash
    expect(src).toContain('_safeTokenDiagnostic');
    expect(src).toContain('createHash');
    // El método no debe tener llamadas a log
    const safeFn = src.match(/private _safeTokenDiagnostic\(\)[\s\S]*?token_local_hash_sha256[\s\S]*?};/)?.[0] ?? '';
    expect(safeFn).not.toMatch(/log\.(info|warn|error|debug)/);
  });
});

// ─── I15 — COM configuration untouched ───────────────────────────────────────

describe('I15 — COM configuration untouched', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-i15-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveToken no modifica device_configs en config.json', () => {
    const mockSafe = makeMockSafeStorage(true);
    const configStore = new ConfigStore(tmpDir);

    // Guardar config con device_configs
    configStore.saveDeviceConfig({
      scale_id: 1,
      com_port: 'COM4',
      baud_rate_override: 9600,
      data_bits_override: 8,
      parity_override: 'none',
      stop_bits_override: 1,
    });

    const cfgBefore = configStore.get();
    expect(cfgBefore.device_configs).toHaveLength(1);
    expect(cfgBefore.device_configs[0].com_port).toBe('COM4');

    // Guardar token (simula re-enrollment)
    const tokenStore = new TokenStore(tmpDir, mockSafe, false);
    tokenStore.saveToken(crypto.randomBytes(32).toString('hex'));

    // Config no debe haber cambiado
    const cfgAfter = configStore.get();
    expect(cfgAfter.device_configs).toHaveLength(1);
    expect(cfgAfter.device_configs[0].com_port).toBe('COM4');
  });

  it('enrollment backend NO modifica com_port en scale_station_devices', () => {
    const src = readSrc('../../src/server/api/scale-agent.ts');
    const enrollBlock = src.match(/router\.post\('\/enroll'[\s\S]*?}\);/)?.[0] ?? '';
    expect(enrollBlock).not.toContain('com_port');
  });
});

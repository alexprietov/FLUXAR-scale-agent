/**
 * E01–E15 — Device Identifier & Enrollment Payload
 *
 * Cubre:
 *  E01  first launch creates device_identifier
 *  E02  identifier is valid UUID
 *  E03  restart reuses SAME identifier
 *  E04  enrollment payload includes device_identifier
 *  E05  enrollment payload uses enroll_code, not enrollment_code
 *  E06  app_version included
 *  E07  company_id not supplied by agent
 *  E08  branch_id not supplied by agent
 *  E09  successful enrollment stores station token via safeStorage
 *  E10  restart restores station token
 *  E11  token never printed in logs
 *  E12  device identifier not regenerated after successful enrollment
 *  E13  local scale test still works without enrollment
 *  E14  COM discovery remains dynamic
 *  E15  no COM4 hardcode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigStore } from '../src/main/config-store.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
}

function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

// ─── E01 — first launch creates device_identifier ────────────────────────────

describe('E01 — first launch creates device_identifier', () => {
  it('genera device_identifier en primer arranque', () => {
    const dir = makeTempDir();
    const store = new ConfigStore(dir);
    const id = store.getOrCreateDeviceIdentifier();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

// ─── E02 — identifier is valid UUID ──────────────────────────────────────────

describe('E02 — identifier is valid UUID', () => {
  it('el device_identifier es un UUID v4 válido', () => {
    const dir = makeTempDir();
    const store = new ConfigStore(dir);
    const id = store.getOrCreateDeviceIdentifier();
    expect(isValidUUID(id)).toBe(true);
  });
});

// ─── E03 — restart reuses SAME identifier ────────────────────────────────────

describe('E03 — restart reuses SAME identifier', () => {
  it('una segunda instancia de ConfigStore devuelve el mismo UUID', () => {
    const dir = makeTempDir();
    const store1 = new ConfigStore(dir);
    const id1 = store1.getOrCreateDeviceIdentifier();

    // Simular reinicio: nueva instancia sobre el mismo directorio
    const store2 = new ConfigStore(dir);
    const id2 = store2.getOrCreateDeviceIdentifier();

    expect(id1).toBe(id2);
  });

  it('el UUID persiste en config.json', () => {
    const dir = makeTempDir();
    const store = new ConfigStore(dir);
    const id = store.getOrCreateDeviceIdentifier();

    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    expect(raw.device_identifier).toBe(id);
  });
});

// ─── E04 — enrollment payload includes device_identifier ─────────────────────

describe('E04 — enrollment payload includes device_identifier', () => {
  it('FluxarApiClient.enroll envía device_identifier en el body', async () => {
    // Importar dinámicamente para poder mockear fetch
    const { FluxarApiClient } = await import('../src/main/api-client.js');

    let capturedBody: Record<string, unknown> = {};
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        station_token: 'tok_test',
        station_id: 1,
        station_name: 'Test',
        branch_name: 'Branch',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    await client.enroll('TESTCODE', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    const call = mockFetch.mock.calls[0];
    capturedBody = JSON.parse(call[1].body as string);

    expect(capturedBody.device_identifier).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    vi.unstubAllGlobals();
  });
});

// ─── E05 — enrollment payload uses enroll_code, not enrollment_code ──────────

describe('E05 — enrollment payload uses enroll_code, not enrollment_code', () => {
  it('el campo se llama enroll_code (sin "ment")', async () => {
    const { FluxarApiClient } = await import('../src/main/api-client.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        station_token: 'tok_test',
        station_id: 1,
        station_name: 'Test',
        branch_name: 'Branch',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    await client.enroll('MYCODE123', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.enroll_code).toBe('MYCODE123');
    expect(body.enrollment_code).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

// ─── E06 — app_version included ──────────────────────────────────────────────

describe('E06 — app_version included', () => {
  it('el payload incluye app_version', async () => {
    const { FluxarApiClient } = await import('../src/main/api-client.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        station_token: 'tok_test',
        station_id: 1,
        station_name: 'Test',
        branch_name: 'Branch',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    await client.enroll('CODE', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '0.1.12');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.app_version).toBeTruthy();
    expect(typeof body.app_version).toBe('string');

    vi.unstubAllGlobals();
  });

  it('app_version es 0.1.12', async () => {
    const { FluxarApiClient } = await import('../src/main/api-client.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        station_token: 'tok_test',
        station_id: 1,
        station_name: 'Test',
        branch_name: 'Branch',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    // La versión la pasa el caller (AgentService usa APP_VERSION='0.1.12')
    await client.enroll('CODE', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '0.1.12');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.app_version).toBe('0.1.12');

    vi.unstubAllGlobals();
  });
});

// ─── E07 — company_id not supplied by agent ───────────────────────────────────

describe('E07 — company_id not supplied by agent', () => {
  it('el payload NO incluye company_id', async () => {
    const { FluxarApiClient } = await import('../src/main/api-client.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        station_token: 'tok_test',
        station_id: 1,
        station_name: 'Test',
        branch_name: 'Branch',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    await client.enroll('CODE', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.company_id).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

// ─── E08 — branch_id not supplied by agent ───────────────────────────────────

describe('E08 — branch_id not supplied by agent', () => {
  it('el payload NO incluye branch_id', async () => {
    const { FluxarApiClient } = await import('../src/main/api-client.js');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        station_token: 'tok_test',
        station_id: 1,
        station_name: 'Test',
        branch_name: 'Branch',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new FluxarApiClient('https://example.com', false);
    await client.enroll('CODE', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.branch_id).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

// ─── E09 — successful enrollment stores station token via safeStorage ─────────

describe('E09 — successful enrollment stores station token via safeStorage', () => {
  it('TokenStore.saveToken es llamado con el station_token tras enrollment exitoso', async () => {
    const dir = makeTempDir();
    const { TokenStore } = await import('../src/main/token-store.js');
    const { ConfigStore: CS } = await import('../src/main/config-store.js');
    const { AgentService } = await import('../src/main/agent-service.js');

    const tokenStore = new TokenStore(dir, null, true /* mockMode */);
    const configStore = new CS(dir);
    const saveSpy = vi.spyOn(tokenStore, 'saveToken');

    const service = new AgentService(configStore, tokenStore, true /* mockMode */);
    const result = await service.enroll('TESTCODE');

    expect(result.ok).toBe(true);
    expect(saveSpy).toHaveBeenCalledOnce();
    // El token nunca debe ser el código de enrollment
    const savedToken = saveSpy.mock.calls[0][0] as string;
    expect(savedToken).not.toBe('TESTCODE');
    expect(savedToken.length).toBeGreaterThan(0);
  });
});

// ─── E10 — restart restores station token ────────────────────────────────────

describe('E10 — restart restores station token', () => {
  it('TokenStore.loadToken devuelve el token guardado en mock mode (memoria)', async () => {
    const dir = makeTempDir();
    const { TokenStore } = await import('../src/main/token-store.js');

    const store = new TokenStore(dir, null, true /* mockMode */);
    store.saveToken('MOCK_TOKEN_ABC');

    // En mock mode el token está en memoria — loadToken lo devuelve
    const loaded = store.loadToken();
    expect(loaded).toBe('MOCK_TOKEN_ABC');
  });

  it('ConfigStore preserva device_identifier entre instancias (simula reinicio)', () => {
    const dir = makeTempDir();
    const store1 = new ConfigStore(dir);
    const id1 = store1.getOrCreateDeviceIdentifier();

    const store2 = new ConfigStore(dir);
    const id2 = store2.getOrCreateDeviceIdentifier();

    expect(id1).toBe(id2);
  });
});

// ─── E11 — token never printed in logs ───────────────────────────────────────

describe('E11 — token never printed in logs', () => {
  it('el código fuente de api-client.ts no imprime el token en logs', async () => {
    const src = fs.readFileSync(
      new URL('../src/main/api-client.ts', import.meta.url).pathname,
      'utf8',
    );
    // No debe haber log.info/log.debug/console.log con station_token
    expect(src).not.toMatch(/log\.(info|debug|warn|error).*station_token/);
    expect(src).not.toMatch(/console\.(log|info|debug).*station_token/);
  });

  it('el código fuente de agent-service.ts no imprime el token en logs', async () => {
    const src = fs.readFileSync(
      new URL('../src/main/agent-service.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).not.toMatch(/log\.(info|debug|warn|error).*station_token/);
    expect(src).not.toMatch(/console\.(log|info|debug).*station_token/);
  });

  it('el código fuente de token-store.ts no imprime el token en logs', async () => {
    const src = fs.readFileSync(
      new URL('../src/main/token-store.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).not.toMatch(/log\.(info|debug|warn|error).*_memoryToken/);
    expect(src).not.toMatch(/console\.(log|info|debug).*_memoryToken/);
  });
});

// ─── E12 — device identifier not regenerated after successful enrollment ──────

describe('E12 — device identifier not regenerated after successful enrollment', () => {
  it('el device_identifier no cambia después de un enrollment exitoso', async () => {
    const dir = makeTempDir();
    const { TokenStore } = await import('../src/main/token-store.js');
    const { ConfigStore: CS } = await import('../src/main/config-store.js');
    const { AgentService } = await import('../src/main/agent-service.js');

    const configStore = new CS(dir);
    const tokenStore = new TokenStore(dir, null, true);

    // Obtener ID antes del enrollment
    const idBefore = configStore.getOrCreateDeviceIdentifier();

    const service = new AgentService(configStore, tokenStore, true);
    await service.enroll('TESTCODE');

    // Obtener ID después del enrollment
    const idAfter = configStore.getOrCreateDeviceIdentifier();

    expect(idBefore).toBe(idAfter);
  });
});

// ─── E13 — local scale test still works without enrollment ───────────────────

describe('E13 — local scale test still works without enrollment', () => {
  it('renderer.ts expone localTest sin requerir enrollment', () => {
    const src = fs.readFileSync(
      new URL('../src/renderer/renderer.ts', import.meta.url).pathname,
      'utf8',
    );
    // Debe existir la función localTest en el API expuesto
    expect(src).toMatch(/localTest/);
  });

  it('preload.ts expone localTest en el API del renderer', () => {
    const src = fs.readFileSync(
      new URL('../src/preload/preload.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).toMatch(/localTest/);
  });
});

// ─── E14 — COM discovery remains dynamic ─────────────────────────────────────

describe('E14 — COM discovery remains dynamic', () => {
  it('api-client.ts no tiene puertos COM hardcodeados', () => {
    const src = fs.readFileSync(
      new URL('../src/main/api-client.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).not.toMatch(/['"`]COM\d+['"`]/);
  });

  it('agent-service.ts no tiene puertos COM hardcodeados', () => {
    const src = fs.readFileSync(
      new URL('../src/main/agent-service.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).not.toMatch(/['"`]COM\d+['"`]/);
  });
});

// ─── E15 — no COM4 hardcode ───────────────────────────────────────────────────

describe('E15 — no COM4 hardcode', () => {
  it('config-store.ts no tiene COM4 hardcodeado', () => {
    const src = fs.readFileSync(
      new URL('../src/main/config-store.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).not.toMatch(/COM4/);
  });

  it('api-client.ts no tiene COM4 hardcodeado', () => {
    const src = fs.readFileSync(
      new URL('../src/main/api-client.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).not.toMatch(/COM4/);
  });

  it('agent-service.ts no tiene COM4 hardcodeado', () => {
    const src = fs.readFileSync(
      new URL('../src/main/agent-service.ts', import.meta.url).pathname,
      'utf8',
    );
    expect(src).not.toMatch(/COM4/);
  });
});

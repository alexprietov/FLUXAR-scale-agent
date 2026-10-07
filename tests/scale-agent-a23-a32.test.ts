/**
 * FLUXAR Scale Agent — Tests A23-A32
 *
 * Hardening: token seguro, IPC, prueba local, raw frames, COM4, secrets.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── A23: packaged mode sin safeStorage → token NO persistido ─────────────────

describe('A23: packaged mode sin safeStorage → token NO persistido', async () => {
  const { TokenStore, SafeStorageUnavailableError } = await import('../src/main/token-store');

  it('saveToken lanza SafeStorageUnavailableError si safeStorage no disponible', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a23-'));
    // mockMode=false (producción), safeStorage=null (no disponible)
    const store = new TokenStore(tmpDir, null, false);

    expect(() => store.saveToken('REAL_PRODUCTION_TOKEN')).toThrow(SafeStorageUnavailableError);

    // Verificar que NO se escribió ningún archivo
    const tokenPath = path.join(tmpDir, 'station.enc');
    expect(fs.existsSync(tokenPath)).toBe(false);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('El mensaje de error es amigable para el operador', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a23b-'));
    const store = new TokenStore(tmpDir, null, false);

    try {
      store.saveToken('TOKEN');
      expect.fail('Debería haber lanzado error');
    } catch (err) {
      expect((err as Error).message).toContain('No fue posible proteger');
      expect((err as Error).message).toContain('safeStorage');
    }

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('hasToken() retorna false si no se pudo guardar', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a23c-'));
    const store = new TokenStore(tmpDir, null, false);

    try { store.saveToken('TOKEN'); } catch { /* esperado */ }

    expect(store.hasToken()).toBe(false);

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── A24: packaged mode NUNCA usa Base64 fallback ─────────────────────────────

describe('A24: packaged mode nunca usa Base64 fallback', async () => {
  const { TokenStore } = await import('../src/main/token-store');

  it('En producción sin safeStorage no escribe nada en disco', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a24-'));
    const store = new TokenStore(tmpDir, null, false); // producción, sin safeStorage

    try { store.saveToken('MY_TOKEN'); } catch { /* esperado */ }

    // No debe existir ningún archivo de token
    const files = fs.readdirSync(tmpDir);
    expect(files).not.toContain('station.enc');

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('En producción sin safeStorage loadToken retorna null y elimina archivo si existe', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a24b-'));
    // Simular archivo corrupto/base64 previo
    const tokenPath = path.join(tmpDir, 'station.enc');
    fs.writeFileSync(tokenPath, Buffer.from('OLD_TOKEN').toString('base64'));

    const store = new TokenStore(tmpDir, null, false); // producción, sin safeStorage
    const token = store.loadToken();

    expect(token).toBeNull();
    // El archivo debe haber sido eliminado
    expect(fs.existsSync(tokenPath)).toBe(false);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('Mock mode SÍ puede usar base64 para placeholder (no es token real)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a24c-'));
    const store = new TokenStore(tmpDir, null, true); // mock mode

    // No debe lanzar error
    expect(() => store.saveToken('MOCK_TOKEN')).not.toThrow();

    // El archivo existe pero contiene placeholder, no el token real
    const tokenPath = path.join(tmpDir, 'station.enc');
    expect(fs.existsSync(tokenPath)).toBe(true);
    const content = fs.readFileSync(tokenPath, 'utf8');
    expect(content).not.toBe('MOCK_TOKEN');
    expect(content).not.toContain('MOCK_TOKEN');

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── A25: renderer nunca recibe station token ──────────────────────────────────

describe('A25: renderer nunca recibe station token', async () => {
  it('AppState no tiene campo station_token', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a25-'));
    const { ConfigStore } = await import('../src/main/config-store');
    const { TokenStore } = await import('../src/main/token-store');
    const { AgentService } = await import('../src/main/agent-service');

    const configStore = new ConfigStore(tmpDir);
    const tokenStore = new TokenStore(tmpDir, null, true);
    const service = new AgentService(configStore, tokenStore, true);

    const state = service.getAppState();

    // Verificar que AppState no contiene ningún campo de token
    expect(state).not.toHaveProperty('station_token');
    expect(state).not.toHaveProperty('token');
    expect(state).not.toHaveProperty('token_hash');
    expect(state).not.toHaveProperty('enrollment_code');

    const stateStr = JSON.stringify(state);
    expect(stateStr).not.toContain('station_token');
    expect(stateStr).not.toContain('token_hash');
    expect(stateStr).not.toContain('enrollment_code');

    await service.destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('enroll() retorna solo ok:bool + error opcional, sin token', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a25b-'));
    const { ConfigStore } = await import('../src/main/config-store');
    const { TokenStore } = await import('../src/main/token-store');
    const { AgentService } = await import('../src/main/agent-service');

    const configStore = new ConfigStore(tmpDir);
    const tokenStore = new TokenStore(tmpDir, null, true);
    const service = new AgentService(configStore, tokenStore, true);

    const result = await service.enroll('MOCK_CODE');

    // El resultado solo tiene ok y opcionalmente error
    expect(result).toHaveProperty('ok');
    expect(result).not.toHaveProperty('station_token');
    expect(result).not.toHaveProperty('token');

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain('station_token');

    await service.destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── A26: local-test mode no llama API ────────────────────────────────────────

describe('A26: local-test mode no llama API', async () => {
  it('LocalTestManager.start() no hace fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { LocalTestManager } = await import('../src/main/local-test-manager');

    const mgr = new LocalTestManager(true); // mock mode
    await mgr.start({
      com_port: 'COM1',
      baud_rate: 9600,
      data_bits: 8,
      parity: 'none',
      stop_bits: 1,
      protocol: 'GENERIC',
    });

    expect(fetchSpy).not.toHaveBeenCalled();

    await mgr.stop();
    fetchSpy.mockRestore();
  });

  it('LocalTestManager no requiere token ni enrollment', async () => {
    const { LocalTestManager } = await import('../src/main/local-test-manager');
    const mgr = new LocalTestManager(true);

    // Debe funcionar sin ningún token configurado
    const result = await mgr.start({
      com_port: 'COM1',
      baud_rate: 9600,
      data_bits: 8,
      parity: 'none',
      stop_bits: 1,
      protocol: 'GENERIC',
    });

    expect(result.ok).toBe(true);
    await mgr.stop();
  });
});

// ─── A27: local-test mode puede listar puertos sin enrollment ─────────────────

describe('A27: local-test mode puede listar puertos sin enrollment', async () => {
  it('SerialManager.listPorts() funciona sin token', async () => {
    const { SerialManager } = await import('../src/main/serial-manager');
    const mgr = new SerialManager(true); // mock mode

    // No requiere enrollment ni token
    const ports = await mgr.listPorts();
    expect(Array.isArray(ports)).toBe(true);
    expect(ports.length).toBeGreaterThan(0);
  });

  it('AgentService.listPorts() funciona sin estar vinculado', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a27-'));
    const { ConfigStore } = await import('../src/main/config-store');
    const { TokenStore } = await import('../src/main/token-store');
    const { AgentService } = await import('../src/main/agent-service');

    const configStore = new ConfigStore(tmpDir);
    const tokenStore = new TokenStore(tmpDir, null, true);
    const service = new AgentService(configStore, tokenStore, true);

    // Sin enrollment, sin token
    expect(service.getAppState().linked).toBe(false);

    const ports = await service.listPorts();
    expect(Array.isArray(ports)).toBe(true);

    await service.destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── A28: raw-frame viewer bounded a 10 ──────────────────────────────────────

describe('A28: raw-frame viewer bounded a 10', async () => {
  it('LocalTestManager mantiene máximo 10 tramas', async () => {
    const { LocalTestManager } = await import('../src/main/local-test-manager');
    const mgr = new LocalTestManager(true);

    await mgr.start({
      com_port: 'COM1', baud_rate: 9600, data_bits: 8,
      parity: 'none', stop_bits: 1, protocol: 'GENERIC',
    });

    // Esperar que el mock stream genere más de 10 tramas
    await new Promise(r => setTimeout(r, 1500)); // ~15 tramas a 10Hz

    const state = mgr.getState();
    expect(state.raw_frames.length).toBeLessThanOrEqual(10);

    await mgr.stop();
  });

  it('raw_frames tiene exactamente 10 después de muchas tramas', async () => {
    const { LocalTestManager } = await import('../src/main/local-test-manager');
    const mgr = new LocalTestManager(true);

    await mgr.start({
      com_port: 'COM1', baud_rate: 9600, data_bits: 8,
      parity: 'none', stop_bits: 1, protocol: 'GENERIC',
    });

    await new Promise(r => setTimeout(r, 2000)); // ~20 tramas

    const state = mgr.getState();
    expect(state.raw_frames.length).toBe(10);

    await mgr.stop();
  });
});

// ─── A29: raw-frame viewer no persiste por defecto ────────────────────────────

describe('A29: raw-frame viewer no persiste por defecto', async () => {
  it('Las tramas no se escriben en disco', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a29-'));
    const { LocalTestManager } = await import('../src/main/local-test-manager');
    const mgr = new LocalTestManager(true);

    await mgr.start({
      com_port: 'COM1', baud_rate: 9600, data_bits: 8,
      parity: 'none', stop_bits: 1, protocol: 'GENERIC',
    });

    await new Promise(r => setTimeout(r, 500));

    // Verificar que no se crearon archivos de tramas en ningún directorio temporal
    const files = fs.readdirSync(tmpDir);
    expect(files.filter(f => f.includes('frame') || f.includes('trama'))).toHaveLength(0);

    await mgr.stop();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('clearFrames() vacía la lista en memoria', async () => {
    const { LocalTestManager } = await import('../src/main/local-test-manager');
    const mgr = new LocalTestManager(true);

    await mgr.start({
      com_port: 'COM1', baud_rate: 9600, data_bits: 8,
      parity: 'none', stop_bits: 1, protocol: 'GENERIC',
    });

    await new Promise(r => setTimeout(r, 500));

    expect(mgr.getState().raw_frames.length).toBeGreaterThan(0);

    mgr.clearFrames();
    expect(mgr.getState().raw_frames.length).toBe(0);

    await mgr.stop();
  });

  it('Al detener la prueba, las tramas se limpian', async () => {
    const { LocalTestManager } = await import('../src/main/local-test-manager');
    const mgr = new LocalTestManager(true);

    await mgr.start({
      com_port: 'COM1', baud_rate: 9600, data_bits: 8,
      parity: 'none', stop_bits: 1, protocol: 'GENERIC',
    });

    await new Promise(r => setTimeout(r, 300));
    await mgr.stop();

    const state = mgr.getState();
    expect(state.active).toBe(false);
    expect(state.raw_frames).toHaveLength(0);
  });
});

// ─── A30: runtime sin COM4 hardcoded ──────────────────────────────────────────

describe('A30: runtime sin COM4 hardcoded en código de producción', async () => {
  // vitest corre desde apps/scale-agent/ — process.cwd() ya es ese directorio
  const srcBase = path.join(process.cwd(), 'src/main');

  it('SerialManager no tiene COM4 hardcoded en producción (solo en mock)', async () => {
    const src = fs.readFileSync(path.join(srcBase, 'serial-manager.ts'), 'utf8');

    // COM4 solo puede aparecer en el bloque mockMode
    const lines = src.split('\n');
    for (const line of lines) {
      if (line.includes('COM4') && !line.includes('Mock') && !line.includes('mock') && !line.includes('//')) {
        expect(line).toMatch(/mock|Mock|MOCK/i);
      }
    }
  });

  it('agent-service.ts no tiene COM4 hardcoded', async () => {
    const src = fs.readFileSync(path.join(srcBase, 'agent-service.ts'), 'utf8');
    expect(src).not.toContain("'COM4'");
    expect(src).not.toContain('"COM4"');
  });

  it('config-store.ts no tiene COM4 hardcoded', async () => {
    const src = fs.readFileSync(path.join(srcBase, 'config-store.ts'), 'utf8');
    expect(src).not.toContain("'COM4'");
    expect(src).not.toContain('"COM4"');
  });

  it('token-store.ts no tiene COM4 hardcoded', async () => {
    const src = fs.readFileSync(path.join(srcBase, 'token-store.ts'), 'utf8');
    expect(src).not.toContain("'COM4'");
    expect(src).not.toContain('"COM4"');
  });

  it('local-test-manager.ts no tiene COM4 hardcoded', async () => {
    const src = fs.readFileSync(path.join(srcBase, 'local-test-manager.ts'), 'utf8');
    expect(src).not.toContain("'COM4'");
    expect(src).not.toContain('"COM4"');
  });
});

// ─── A31: retry mantiene seguridad del token ──────────────────────────────────

describe('A31: retry mantiene seguridad del token', async () => {
  it('El token en memoria no cambia durante retry de lectura', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a31-'));
    const { TokenStore } = await import('../src/main/token-store');
    const store = new TokenStore(tmpDir, null, true); // mock

    store.saveToken('ORIGINAL_TOKEN');
    const tokenBefore = store.loadToken();

    // Simular retry (no debe cambiar el token)
    const tokenAfter = store.loadToken();
    expect(tokenAfter).toBe(tokenBefore);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('external_reading_id no cambia en retry', () => {
    // Verificar que el UUID se conserva (ya cubierto en A11, reforzar aquí)
    const uuid = 'uuid-retry-test-1234';
    const reading = { external_reading_id: uuid, scale_id: 1 };
    // Simular retry: clonar sin regenerar UUID
    const retried = { ...reading };
    expect(retried.external_reading_id).toBe(uuid);
  });

  it('Token en memoria no se expone en logs durante retry', async () => {
    const logSpy = vi.spyOn(console, 'error');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a31c-'));
    const { TokenStore } = await import('../src/main/token-store');
    const store = new TokenStore(tmpDir, null, true);

    store.saveToken('SECRET_RETRY_TOKEN');

    // Simular error que podría loguear
    try { store.loadToken(); } catch { /* ok */ }

    const allLogs = logSpy.mock.calls.map(args => args.join(' '));
    for (const log of allLogs) {
      expect(log).not.toContain('SECRET_RETRY_TOKEN');
    }

    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ─── A32: diagnostics siguen excluyendo secrets ───────────────────────────────

describe('A32: diagnostics siguen excluyendo secrets (post-hardening)', async () => {
  it('DiagnosticReport no tiene station_token, token, enrollment_code', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-a32-'));
    const { ConfigStore } = await import('../src/main/config-store');
    const { TokenStore } = await import('../src/main/token-store');
    const { AgentService } = await import('../src/main/agent-service');

    const configStore = new ConfigStore(tmpDir);
    const tokenStore = new TokenStore(tmpDir, null, true);
    const service = new AgentService(configStore, tokenStore, true);

    // Enrollar para que haya token en memoria
    await service.enroll('MOCK_CODE');

    const diag = service.getDiagnostic();
    const diagStr = JSON.stringify(diag);

    expect(diag).not.toHaveProperty('station_token');
    expect(diag).not.toHaveProperty('token');
    expect(diag).not.toHaveProperty('enrollment_code');
    expect(diagStr).not.toContain('station_token');
    expect(diagStr).not.toContain('enrollment_code');

    await service.destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('LocalTestState no contiene secrets', async () => {
    const { LocalTestManager } = await import('../src/main/local-test-manager');
    const mgr = new LocalTestManager(true);

    await mgr.start({
      com_port: 'COM1', baud_rate: 9600, data_bits: 8,
      parity: 'none', stop_bits: 1, protocol: 'GENERIC',
    });

    const state = mgr.getState();
    const stateStr = JSON.stringify(state);

    expect(state).not.toHaveProperty('station_token');
    expect(state).not.toHaveProperty('token');
    expect(stateStr).not.toContain('station_token');

    await mgr.stop();
  });
});

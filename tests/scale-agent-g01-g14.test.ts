/**
 * G01–G14: Tests de safeStorage / TokenStore / enrollment seguro
 *
 * INC-SCALE-SAFESTORAGE-01
 *
 * ROOT CAUSE: main.ts condicionaba safeStorage a app.isPackaged.
 * En modo fuente (npx electron .), app.isPackaged=false → safeStorageRef=null
 * → TokenStore en producción con safeStorage=null → SafeStorageUnavailableError
 * aunque el OS sí tiene safeStorage disponible.
 *
 * G01  TokenStore inicializado solo después de app.whenReady (verificación estática)
 * G02  safeStorage disponible → saveToken cifra y persiste
 * G03  token cifrado persiste en disco (archivo existe)
 * G04  restart: loadToken descifra el mismo token
 * G05  safeStorage no disponible → saveToken lanza, NO escribe plaintext
 * G06  safeStorage no disponible → enrollment devuelve error con mensaje correcto
 * G07  token nunca escrito en plaintext (archivo no contiene el token)
 * G08  token nunca en logs (saveToken no llama log con el token)
 * G09  enrollment backend OK + save local falla → estado limpiado correctamente
 * G10  código consumido no puede reutilizarse (one-time, verificación estática)
 * G11  renderer nunca recibe/almacena el token raw (verificación estática)
 * G12  prueba local no afectada por safeStorage
 * G13  COM4 no hardcodeado en main.ts
 * G14  device_identifier existente persiste entre reinicios
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

// ─── Mock de Electron.SafeStorage ────────────────────────────────────────────

function makeMockSafeStorage(available: boolean): {
  isEncryptionAvailable: () => boolean;
  encryptString: (s: string) => Buffer;
  decryptString: (b: Buffer) => string;
} {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => {
      // Simular cifrado: XOR con clave fija (no es cifrado real, solo para tests)
      const buf = Buffer.from(s, 'utf8');
      const key = 0x42;
      return Buffer.from(buf.map(b => b ^ key));
    },
    decryptString: (b: Buffer) => {
      const key = 0x42;
      return Buffer.from(b.map(byte => byte ^ key)).toString('utf8');
    },
  };
}

// ─── Import dinámico de TokenStore ───────────────────────────────────────────

// Importamos directamente desde src (TypeScript) usando el path relativo
// para evitar dependencias de Electron en el entorno de test.
// TokenStore no importa electron directamente — recibe safeStorage como parámetro.

// Usamos un import dinámico para poder mockear electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    transports: { file: { resolvePath: vi.fn() } },
  },
}));

import { TokenStore, SafeStorageUnavailableError } from '../src/main/token-store.js';

// ─── G01 — TokenStore inicializado solo después de app.whenReady ─────────────

describe('G01 — TokenStore inicializado solo después de app.whenReady (estático)', () => {
  it('main.ts crea TokenStore dentro del callback de app.whenReady()', () => {
    const src = readSrc('src/main/main.ts');
    // Buscar el bloque whenReady
    const whenReadyBlock = src.match(/app\.whenReady\(\)\.then\(async \(\) => \{([\s\S]*?)\}\);/)?.[1] ?? '';
    expect(whenReadyBlock).toContain('new TokenStore(');
  });

  it('main.ts NO crea TokenStore fuera de app.whenReady()', () => {
    const src = readSrc('src/main/main.ts');
    // Dividir en: antes de whenReady y dentro de whenReady
    const beforeWhenReady = src.split('app.whenReady()')[0];
    expect(beforeWhenReady).not.toContain('new TokenStore(');
  });

  it('main.ts NO condiciona safeStorage a app.isPackaged', () => {
    const src = readSrc('src/main/main.ts');
    // La línea que causó el bug: app.isPackaged ? safeStorage : null
    expect(src).not.toMatch(/app\.isPackaged\s*\?\s*.*safeStorage/);
  });

  it('main.ts pasa safeStorage sin condición de isPackaged', () => {
    const src = readSrc('src/main/main.ts');
    // Debe obtener safeStorage sin condicional de isPackaged
    expect(src).toContain("require('electron')");
    expect(src).toContain('safeStorage');
    // La asignación de safeStorageRef NO debe tener app.isPackaged como guard
    const safeStorageAssignment = src.match(/const safeStorageRef\s*=.*$/m)?.[0] ?? '';
    expect(safeStorageAssignment).not.toContain('isPackaged');
  });
});

// ─── G02 — safeStorage disponible → saveToken cifra ─────────────────────────

describe('G02 — safeStorage disponible → saveToken cifra y persiste', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveToken con safeStorage disponible no lanza', () => {
    const store = new TokenStore(tmpDir, makeMockSafeStorage(true), false);
    expect(() => store.saveToken('test-token-abc123')).not.toThrow();
  });

  it('hasToken() retorna true después de saveToken exitoso', () => {
    const store = new TokenStore(tmpDir, makeMockSafeStorage(true), false);
    store.saveToken('test-token-abc123');
    expect(store.hasToken()).toBe(true);
  });
});

// ─── G03 — token cifrado persiste en disco ────────────────────────────────────

describe('G03 — token cifrado persiste en disco', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('archivo station.enc existe después de saveToken', () => {
    const store = new TokenStore(tmpDir, makeMockSafeStorage(true), false);
    store.saveToken('test-token-abc123');
    expect(fs.existsSync(path.join(tmpDir, 'station.enc'))).toBe(true);
  });

  it('archivo station.enc NO existe si saveToken nunca fue llamado', () => {
    new TokenStore(tmpDir, makeMockSafeStorage(true), false);
    expect(fs.existsSync(path.join(tmpDir, 'station.enc'))).toBe(false);
  });
});

// ─── G04 — restart: loadToken descifra el mismo token ────────────────────────

describe('G04 — restart: loadToken descifra el mismo token', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadToken en nueva instancia (simula restart) retorna el mismo token', () => {
    const mockSafe = makeMockSafeStorage(true);
    const token = 'station-token-' + crypto.randomBytes(16).toString('hex');

    // Primera instancia: guardar
    const store1 = new TokenStore(tmpDir, mockSafe, false);
    store1.saveToken(token);

    // Segunda instancia (simula restart): cargar
    const store2 = new TokenStore(tmpDir, mockSafe, false);
    const loaded = store2.loadToken();
    expect(loaded).toBe(token);
  });
});

// ─── G05 — safeStorage no disponible → NO plaintext ─────────────────────────

describe('G05 — safeStorage no disponible → saveToken lanza, NO escribe plaintext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveToken lanza SafeStorageUnavailableError cuando safeStorage no disponible', () => {
    const store = new TokenStore(tmpDir, makeMockSafeStorage(false), false);
    expect(() => store.saveToken('secret-token')).toThrow(SafeStorageUnavailableError);
  });

  it('NO se escribe ningún archivo cuando safeStorage no disponible', () => {
    const store = new TokenStore(tmpDir, makeMockSafeStorage(false), false);
    try { store.saveToken('secret-token'); } catch { /* esperado */ }
    expect(fs.existsSync(path.join(tmpDir, 'station.enc'))).toBe(false);
  });

  it('safeStorage=null también lanza SafeStorageUnavailableError', () => {
    const store = new TokenStore(tmpDir, null, false);
    expect(() => store.saveToken('secret-token')).toThrow(SafeStorageUnavailableError);
  });
});

// ─── G06 — safeStorage no disponible → mensaje de error correcto ─────────────

describe('G06 — safeStorage no disponible → mensaje de error correcto', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('el mensaje de error menciona almacenamiento seguro', () => {
    const store = new TokenStore(tmpDir, makeMockSafeStorage(false), false);
    let caught: Error | null = null;
    try { store.saveToken('secret-token'); } catch (e) { caught = e as Error; }
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('almacenamiento seguro');
  });

  it('el error es instancia de SafeStorageUnavailableError', () => {
    const store = new TokenStore(tmpDir, makeMockSafeStorage(false), false);
    let caught: Error | null = null;
    try { store.saveToken('secret-token'); } catch (e) { caught = e as Error; }
    expect(caught).toBeInstanceOf(SafeStorageUnavailableError);
    expect(caught!.name).toBe('SafeStorageUnavailableError');
  });
});

// ─── G07 — token nunca escrito en plaintext ───────────────────────────────────

describe('G07 — token nunca escrito en plaintext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('el archivo station.enc NO contiene el token en plaintext', () => {
    const token = 'super-secret-token-' + crypto.randomBytes(8).toString('hex');
    const store = new TokenStore(tmpDir, makeMockSafeStorage(true), false);
    store.saveToken(token);

    const fileContent = fs.readFileSync(path.join(tmpDir, 'station.enc'));
    // El archivo no debe contener el token como string legible
    expect(fileContent.toString('utf8')).not.toContain(token);
    expect(fileContent.toString('base64')).not.toBe(Buffer.from(token).toString('base64'));
  });
});

// ─── G08 — token nunca en logs ────────────────────────────────────────────────

describe('G08 — token nunca en logs (verificación estática)', () => {
  it('token-store.ts no llama log con el token como argumento', () => {
    const src = readSrc('src/main/token-store.ts');
    // Verificar que no hay log.*(token) donde token es la variable del parámetro
    // Patrón peligroso: log.info(token) o log.info('msg', token) o log.info(`...${token}`)
    // Excluir comentarios (líneas que empiezan con //)
    const codeLines = src.split('\n').filter(l => !l.trim().startsWith('//'));
    const code = codeLines.join('\n');
    // No debe haber interpolación del token en logs
    expect(code).not.toMatch(/log\.(info|warn|error|debug)\s*\([^)]*\$\{token\}/);
    // No debe haber log(token) directo
    expect(code).not.toMatch(/log\.(info|warn|error|debug)\s*\(\s*token\s*[,)]/);
  });

  it('agent-service.ts no loguea el token de enrollment', () => {
    const src = readSrc('src/main/agent-service.ts');
    // No debe haber log con station_token o result.station_token
    expect(src).not.toMatch(/log\.(info|warn|error|debug)\s*\([^)]*station_token[^)]*\)/);
  });
});

// ─── G09 — enrollment backend OK + save local falla → estado limpiado ────────

describe('G09 — enrollment backend OK + save local falla → estado limpiado', () => {
  it('agent-service.ts limpia estado cuando SafeStorageUnavailableError es lanzado', () => {
    const src = readSrc('src/main/agent-service.ts');
    // Debe verificar el nombre del error y limpiar
    expect(src).toContain('SafeStorageUnavailableError');
    expect(src).toContain('clearToken()');
    expect(src).toContain('clearStationMeta()');
    // El clearToken y clearStationMeta deben estar en el catch de SafeStorageUnavailableError
    const catchBlock = src.match(/if\s*\(\s*\(err as Error\)\.name === 'SafeStorageUnavailableError'\s*\)([\s\S]*?)(?=\n\s*\})/)?.[0] ?? '';
    expect(catchBlock).toContain('clearToken()');
    expect(catchBlock).toContain('clearStationMeta()');
  });

  it('TokenStore.clearToken() elimina el archivo y limpia memoria', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
    try {
      const store = new TokenStore(tmpDir, makeMockSafeStorage(true), false);
      store.saveToken('token-to-clear');
      expect(store.hasToken()).toBe(true);
      store.clearToken();
      expect(store.hasToken()).toBe(false);
      expect(store.hasTokenInMemory()).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'station.enc'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── G10 — código consumido no puede reutilizarse (estático) ─────────────────

describe('G10 — código consumido no puede reutilizarse (verificación estática)', () => {
  it('scale-agent.ts verifica enroll_code_used_at IS NULL en el UPDATE atómico', () => {
    // Verificar en el backend (src/server/api/scale-agent.ts del proyecto principal)
    const backendSrc = fs.readFileSync(
      path.join(ROOT, '../../src/server/api/scale-agent.ts'),
      'utf8',
    );
    expect(backendSrc).toContain('enroll_code_used_at IS NULL');
  });

  it('el backend retorna 409 cuando el código ya fue usado', () => {
    const backendSrc = fs.readFileSync(
      path.join(ROOT, '../../src/server/api/scale-agent.ts'),
      'utf8',
    );
    expect(backendSrc).toContain('ENROLL_CODE_ALREADY_USED');
    expect(backendSrc).toContain('409');
  });
});

// ─── G11 — renderer nunca recibe/almacena el token raw ───────────────────────

describe('G11 — renderer nunca recibe/almacena el token raw (verificación estática)', () => {
  it('renderer.ts no importa TokenStore ni safeStorage', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).not.toContain('TokenStore');
    expect(src).not.toContain('safeStorage');
    expect(src).not.toContain('token-store');
  });

  it('renderer.ts no almacena station_token en localStorage ni variable global', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).not.toContain('localStorage.setItem');
    expect(src).not.toMatch(/window\.\w*[Tt]oken/);
  });

  it('preload.ts no expone el token al renderer', () => {
    const src = readSrc('src/preload/preload.ts');
    // station_token puede aparecer en comentarios (documentando que NO se expone)
    // pero NO debe aparecer como valor retornado o expuesto en contextBridge
    // Verificar que no hay asignación/retorno de station_token como valor
    expect(src).not.toMatch(/contextBridge\.exposeInMainWorld[\s\S]*?station_token\s*:/);
    expect(src).not.toMatch(/return\s*\{[^}]*station_token\s*:/);
  });

  it('el IPC ENROLL solo retorna ok/error, no el token', () => {
    const src = readSrc('src/main/main.ts');
    // El handler de ENROLL llama agentService.enroll() que retorna { ok, error? }
    // No debe retornar el token al renderer
    const enrollHandler = src.match(/IPC\.ENROLL[\s\S]*?return agentService\.enroll\([^)]+\)/)?.[0] ?? '';
    expect(enrollHandler).not.toContain('station_token');
  });
});

// ─── G12 — prueba local no afectada por safeStorage ─────────────────────────

describe('G12 — prueba local no afectada por safeStorage', () => {
  it('local-test-manager.ts no usa TokenStore ni safeStorage', () => {
    const src = readSrc('src/main/local-test-manager.ts');
    expect(src).not.toContain('TokenStore');
    expect(src).not.toContain('safeStorage');
  });

  it('renderer.ts tiene sección de prueba local independiente del enrollment', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('LOCAL_TEST');
    expect(src).toContain('local-test');
  });
});

// ─── G13 — COM4 no hardcodeado en main.ts ────────────────────────────────────

describe('G13 — COM4 no hardcodeado en main.ts', () => {
  it('main.ts no contiene COM4 hardcodeado', () => {
    const src = readSrc('src/main/main.ts');
    expect(src).not.toContain('COM4');
  });
});

// ─── G14 — device_identifier existente persiste entre reinicios ──────────────

import { ConfigStore } from '../src/main/config-store.js';

describe('G14 — device_identifier existente persiste entre reinicios', () => {
  it('ConfigStore.getOrCreateDeviceIdentifier retorna el mismo UUID en llamadas sucesivas', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxar-test-'));
    try {
      const store1 = new ConfigStore(tmpDir);
      const id1 = store1.getOrCreateDeviceIdentifier();
      expect(id1).toBeTruthy();
      expect(id1).toMatch(/^[0-9a-f-]{36}$/); // UUID v4

      // Segunda instancia (simula restart)
      const store2 = new ConfigStore(tmpDir);
      const id2 = store2.getOrCreateDeviceIdentifier();
      expect(id2).toBe(id1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

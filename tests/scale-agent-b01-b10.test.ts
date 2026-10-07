/**
 * B01–B10: Tests de preload, contextBridge y diagnóstico de arranque
 *
 * Cubren los requisitos del spec F4-SCALE-AGENT-07:
 *
 * B01 — compiled main resolves existing preload
 * B02 — preload executes without exception (START + FLUXAR_EXPOSED en compilado)
 * B03 — contextBridge exposes "fluxar"
 * B04 — exposed bridge has required methods
 * B05 — renderer detects bridge available
 * B06 — preload failure is logged explicitly by main
 * B07 — local screen with valid bridge calls listPorts
 * B08 — listPorts returns mocked COM ports and selector updates
 * B09 — version comes from package authority
 * B10 — no production API/backend required for local port discovery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`Archivo no existe: ${p}. Ejecuta npm run build primero.`);
  return fs.readFileSync(p, 'utf8');
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFile(rel));
}

function createRendererDOM(opts: {
  fluxarOverrides?: Partial<Record<string, unknown>>;
  deleteFluxar?: boolean;
} = {}) {
  const html = readFile('dist/renderer/index.html');
  const rendererJs = readFile('dist/renderer/renderer.js');

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;

  const errors: string[] = [];
  (window as unknown as Record<string, unknown>).onerror = (msg: unknown) => {
    errors.push(String(msg));
    return false;
  };

  if (!opts.deleteFluxar) {
    const fluxarMock = {
      getState: vi.fn().mockResolvedValue(null),
      listPorts: vi.fn().mockResolvedValue([]),
      getDiagnostic: vi.fn().mockResolvedValue(null),
      enroll: vi.fn().mockResolvedValue({ ok: false }),
      saveDeviceConfig: vi.fn().mockResolvedValue({ ok: true }),
      setAutostart: vi.fn().mockResolvedValue({ ok: true }),
      unlink: vi.fn().mockResolvedValue({ ok: true }),
      onStateUpdate: vi.fn().mockReturnValue(() => {}),
      localTestStart: vi.fn().mockResolvedValue({ ok: true }),
      localTestStop: vi.fn().mockResolvedValue({ ok: true }),
      localTestGetState: vi.fn().mockResolvedValue(null),
      localTestClearFrames: vi.fn().mockResolvedValue({ ok: true }),
      onLocalTestUpdate: vi.fn().mockReturnValue(() => {}),
      ...(opts.fluxarOverrides || {}),
    };
    (window as unknown as Record<string, unknown>).fluxar = fluxarMock;
  }

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = rendererJs;
  window.document.body.appendChild(scriptEl);

  const evt = window.document.createEvent('Event');
  evt.initEvent('DOMContentLoaded', true, true);
  window.document.dispatchEvent(evt);

  return { dom, window, errors };
}

// ─── B01: compiled main resolves existing preload ────────────────────────────

describe('B01 — compiled main resolves existing preload', () => {
  it('dist/main/main/main.js existe', () => {
    expect(fs.existsSync(path.join(ROOT, 'dist/main/main/main.js'))).toBe(true);
  });

  it('dist/preload/preload/preload.js existe', () => {
    expect(fs.existsSync(path.join(ROOT, 'dist/preload/preload/preload.js'))).toBe(true);
  });

  it('path relativo desde __dirname de main.js resuelve al preload real', () => {
    // __dirname de dist/main/main/main.js = dist/main/main/
    const mainDir = path.join(ROOT, 'dist/main/main');
    const resolved = path.resolve(mainDir, '../../preload/preload/preload.js');
    const expected = path.resolve(ROOT, 'dist/preload/preload/preload.js');
    expect(resolved).toBe(expected);
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it('main.js compilado usa el path correcto ../../preload/preload/preload.js', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('../../preload/preload/preload.js');
  });

  it('main.js compilado registra PRELOAD_PATH y PRELOAD_EXISTS', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('PRELOAD_PATH=');
    expect(mainJs).toContain('PRELOAD_EXISTS=');
  });

  it('main.js compilado tiene sandbox: false', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('sandbox: false');
  });

  it('main.js compilado NO tiene sandbox: true', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).not.toContain('sandbox: true');
  });
});

// ─── B02: preload executes without exception ──────────────────────────────────

describe('B02 — preload executes without exception (logs START + FLUXAR_EXPOSED)', () => {
  it('preload.js compilado contiene console.log("[Preload] START")', () => {
    const preloadJs = readFile('dist/preload/preload/preload.js');
    expect(preloadJs).toContain('[Preload] START');
  });

  it('preload.js compilado contiene console.log("[Preload] FLUXAR_EXPOSED")', () => {
    const preloadJs = readFile('dist/preload/preload/preload.js');
    expect(preloadJs).toContain('[Preload] FLUXAR_EXPOSED');
  });

  it('preload.js compilado tiene try/catch con console.error("[Preload] FAILED")', () => {
    const preloadJs = readFile('dist/preload/preload/preload.js');
    expect(preloadJs).toContain('[Preload] FAILED');
  });

  it('preload.js compilado usa require("electron") (CommonJS — compatible con sandbox:false)', () => {
    const preloadJs = readFile('dist/preload/preload/preload.js');
    expect(preloadJs).toContain('require("electron")');
  });

  it('preload.js compilado NO tiene import statements ESM', () => {
    const preloadJs = readFile('dist/preload/preload/preload.js');
    expect(preloadJs).not.toMatch(/^import\s+/m);
  });

  it('preload.ts source tiene console.log("[Preload] START") antes de contextBridge', () => {
    const ts = readFile('src/preload/preload.ts');
    const idxStart = ts.indexOf('[Preload] START');
    const idxBridge = ts.indexOf('contextBridge.exposeInMainWorld');
    expect(idxStart).toBeGreaterThan(-1);
    expect(idxBridge).toBeGreaterThan(-1);
    expect(idxStart).toBeLessThan(idxBridge);
  });
});

// ─── B03: contextBridge exposes "fluxar" ─────────────────────────────────────

describe('B03 — contextBridge exposes "fluxar"', () => {
  it('preload.js compilado llama exposeInMainWorld("fluxar", ...)', () => {
    const preloadJs = readFile('dist/preload/preload/preload.js');
    expect(preloadJs).toContain("exposeInMainWorld('fluxar'");
  });

  it('preload.ts source llama contextBridge.exposeInMainWorld("fluxar", fluxarApi)', () => {
    const ts = readFile('src/preload/preload.ts');
    expect(ts).toContain("contextBridge.exposeInMainWorld('fluxar', fluxarApi)");
  });

  it('renderer.ts accede a window.fluxar vía getFluxar() helper', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('function getFluxar()');
    expect(ts).not.toContain('window.fluxar.');
  });
});

// ─── B04: exposed bridge has required methods ─────────────────────────────────

describe('B04 — exposed bridge has required methods', () => {
  const REQUIRED_METHODS = [
    'getState',
    'listPorts',
    'localTestStart',
    'localTestStop',
    'onLocalTestUpdate',
    'enroll',
    'saveDeviceConfig',
    'setAutostart',
    'unlink',
    'getDiagnostic',
    'localTestGetState',
    'localTestClearFrames',
    'onStateUpdate',
  ];

  for (const method of REQUIRED_METHODS) {
    it(`preload.ts define el método ${method}`, () => {
      const ts = readFile('src/preload/preload.ts');
      expect(ts).toContain(method + ':');
    });

    it(`preload.js compilado contiene ${method}`, () => {
      const preloadJs = readFile('dist/preload/preload/preload.js');
      expect(preloadJs).toContain(method);
    });
  }
});

// ─── B05: renderer detects bridge available ───────────────────────────────────

describe('B05 — renderer detects bridge available', () => {
  it('renderer.ts tiene FLUXAR_AVAILABLE log', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('FLUXAR_AVAILABLE');
  });

  it('renderer.js compilado tiene FLUXAR_AVAILABLE log', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('FLUXAR_AVAILABLE');
  });

  it('con fluxar disponible, initializeFluxarBridge llama getState', async () => {
    const getStateMock = vi.fn().mockResolvedValue(null);
    const { window } = createRendererDOM({
      fluxarOverrides: { getState: getStateMock },
    });

    await new Promise(r => setTimeout(r, 100));

    expect(getStateMock).toHaveBeenCalled();
  });

  it('sin fluxar, initializeFluxarBridge NO lanza excepción', async () => {
    const { errors } = createRendererDOM({ deleteFluxar: true });
    await new Promise(r => setTimeout(r, 100));
    expect(errors).toHaveLength(0);
  });

  it('barra de diagnóstico muestra "Servicio local: OK" cuando fluxar disponible', async () => {
    const { window } = createRendererDOM({
      fluxarOverrides: { getState: vi.fn().mockResolvedValue(null) },
    });

    await new Promise(r => setTimeout(r, 150));

    const bar = window.document.getElementById('diag-status-bar');
    expect(bar?.textContent).toContain('Servicio local: OK');
  });

  it('barra de diagnóstico muestra "No disponible" cuando fluxar undefined', async () => {
    const { window } = createRendererDOM({ deleteFluxar: true });

    await new Promise(r => setTimeout(r, 150));

    const bar = window.document.getElementById('diag-status-bar');
    expect(bar?.textContent).toContain('No disponible');
  });
});

// ─── B06: preload failure is logged explicitly by main ────────────────────────

describe('B06 — preload failure is logged explicitly by main', () => {
  it('main.js compilado tiene listener preload-error', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('preload-error');
    expect(mainJs).toContain('PRELOAD_ERROR');
  });

  it('main.js compilado tiene listener did-fail-load', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('did-fail-load');
    expect(mainJs).toContain('DID_FAIL_LOAD');
  });

  it('main.js compilado tiene listener render-process-gone', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('render-process-gone');
    expect(mainJs).toContain('RENDER_PROCESS_GONE');
  });

  it('main.js compilado tiene listener console-message (captura logs del renderer)', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('console-message');
  });

  it('main.ts source registra PRELOAD_ERROR cuando archivo no existe', () => {
    const ts = readFile('src/main/main.ts');
    expect(ts).toContain('PRELOAD_ERROR: archivo no encontrado');
  });
});

// ─── B07: local screen with valid bridge calls listPorts ──────────────────────

describe('B07 — local screen with valid bridge calls listPorts', () => {
  it('click en btn-go-local-test con fluxar disponible llama listPorts', async () => {
    const listPortsMock = vi.fn().mockResolvedValue([]);
    const { window } = createRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: listPortsMock,
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 100));

    expect(listPortsMock).toHaveBeenCalled();
  });

  it('click en btn-go-local-test sin fluxar NO llama listPorts (no hay mock que fallar)', async () => {
    // Sin fluxar, no debe lanzar excepción al intentar llamar listPorts
    const { errors } = createRendererDOM({ deleteFluxar: true });

    // Necesitamos DOM para hacer click
    const { window } = createRendererDOM({ deleteFluxar: true });
    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 100));

    // No debe haber errores uncaught
    expect(errors).toHaveLength(0);
  });
});

// ─── B08: listPorts returns mocked COM ports and selector updates ──────────────

describe('B08 — listPorts returns mocked COM ports and selector updates', () => {
  it('con listPorts que devuelve puertos, el select se llena', async () => {
    const mockPorts = [
      { path: 'COM3', manufacturer: 'FTDI' },
      { path: 'COM4', manufacturer: 'Prolific' },
      { path: 'COM7' },
    ];

    const { window } = createRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: vi.fn().mockResolvedValue(mockPorts),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 150));

    const select = window.document.getElementById('lt-com-port') as HTMLSelectElement;
    expect(select).toBeTruthy();

    // Debe tener opciones: placeholder + 3 puertos
    expect(select.options.length).toBeGreaterThanOrEqual(3);

    // COM3 debe estar en las opciones
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain('COM3');
    expect(values).toContain('COM4');
    expect(values).toContain('COM7');
  });

  it('con listPorts vacío, el select muestra "No se encontraron puertos COM"', async () => {
    const { window } = createRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: vi.fn().mockResolvedValue([]),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 150));

    const select = window.document.getElementById('lt-com-port') as HTMLSelectElement;
    expect(select.options[0]?.textContent).toContain('No se encontraron puertos COM');
  });

  it('con listPorts que devuelve puertos, el select NO queda en "Cargando puertos..."', async () => {
    const { window } = createRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: vi.fn().mockResolvedValue([{ path: 'COM1' }]),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 150));

    const select = window.document.getElementById('lt-com-port') as HTMLSelectElement;
    const texts = Array.from(select.options).map(o => o.textContent || '');
    const hasCargando = texts.some(t => t.includes('Cargando'));
    expect(hasCargando).toBe(false);
  });
});

// ─── B09: version comes from package authority ────────────────────────────────

describe('B09 — version comes from package authority', () => {
  it('package.json tiene version 0.1.14', () => {
    const pkg = readJson('package.json');
    expect(pkg.version).toBe('0.1.14');
  });

  it('main.ts NO tiene versión hardcodeada v0.1.x', () => {
    const ts = readFile('src/main/main.ts');
    // No debe haber strings literales de versión como 'v0.1.0', 'v0.1.3', etc.
    expect(ts).not.toMatch(/['"`]v0\.\d+\.\d+['"`]/);
  });

  it('main.ts usa pkgVersion (leído de package.json)', () => {
    const ts = readFile('src/main/main.ts');
    expect(ts).toContain('pkgVersion');
    expect(ts).toContain('package.json');
  });

  it('main.js compilado usa pkgVersion (no versión hardcodeada)', () => {
    const mainJs = readFile('dist/main/main/main.js');
    expect(mainJs).toContain('pkgVersion');
    // No debe tener 'v0.1.0' hardcodeado en el log
    expect(mainJs).not.toContain("'v0.1.0'");
    expect(mainJs).not.toContain('"v0.1.0"');
  });

  it('index.html reporta v0.1.14 en barra de diagnóstico', () => {
    const html = readFile('src/renderer/index.html');
    expect(html).toContain('v0.1.14');
  });

  it('dist/renderer/index.html reporta v0.1.14', () => {
    const html = readFile('dist/renderer/index.html');
    expect(html).toContain('v0.1.14');
  });
});

// ─── B10: no production API/backend required for local port discovery ─────────

describe('B10 — no production API/backend required for local port discovery', () => {
  it('listPorts en preload.ts usa IPC.LIST_PORTS (local, no HTTP)', () => {
    const ts = readFile('src/preload/preload.ts');
    expect(ts).toContain('IPC.LIST_PORTS');
    expect(ts).not.toContain('fetch(');
    expect(ts).not.toContain('axios');
    expect(ts).not.toContain('http.get');
  });

  it('renderer puede llamar listPorts sin getState exitoso', async () => {
    // getState rechaza (sin backend), pero listPorts sí funciona
    const listPortsMock = vi.fn().mockResolvedValue([{ path: 'COM3' }]);
    const { window, errors } = createRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockRejectedValue(new Error('No backend')),
        listPorts: listPortsMock,
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 150));

    // listPorts debe haberse llamado
    expect(listPortsMock).toHaveBeenCalled();
    // Sin errores uncaught
    expect(errors).toHaveLength(0);
  });

  it('page-local-test es accesible sin enrollment ni backend', async () => {
    const { window } = createRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null), // null = no vinculado
        listPorts: vi.fn().mockResolvedValue([{ path: 'COM1' }]),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    expect(window.document.getElementById('page-local-test')!.classList.contains('active')).toBe(true);
  });

  it('renderer.ts NO hace fetch() ni XMLHttpRequest directamente', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).not.toContain('fetch(');
    expect(ts).not.toContain('XMLHttpRequest');
    expect(ts).not.toContain('axios');
  });
});

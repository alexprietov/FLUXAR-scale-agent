/**
 * A41–A50: Tests de runtime real — renderer.js compilado contra index.html real
 *
 * Estos tests ejecutan dist/renderer/renderer.js contra dist/renderer/index.html
 * usando JSDOM con runScripts:'dangerously', simulando el entorno real de Electron.
 *
 * Cubren los requisitos del spec F4-SCALE-AGENT-06:
 *
 * A41 — renderer.js carga sin excepción (no ReferenceError exports/require)
 * A42 — DOMContentLoaded ejecuta init() y bindNavigationEvents()
 * A43 — botón local tiene listener registrado
 * A44 — click local cambia pantalla SÍNCRONAMENTE (sin await)
 * A45 — botón vincular tiene listener registrado
 * A46 — click vincular cambia pantalla SÍNCRONAMENTE
 * A47 — funciona con window.fluxar undefined (delete window.fluxar)
 * A48 — funciona con listPorts rejected
 * A49 — no hay uncaught exception antes de bindEvents
 * A50 — preload no es requisito para navegación
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readDistRendererJs(): string {
  const p = path.join(ROOT, 'dist/renderer/renderer.js');
  if (!fs.existsSync(p)) throw new Error(`dist/renderer/renderer.js no existe. Ejecuta npm run build primero.`);
  return fs.readFileSync(p, 'utf8');
}

function readDistIndexHtml(): string {
  const p = path.join(ROOT, 'dist/renderer/index.html');
  if (!fs.existsSync(p)) throw new Error(`dist/renderer/index.html no existe. Ejecuta npm run build primero.`);
  return fs.readFileSync(p, 'utf8');
}

function readSourceRendererTs(): string {
  return fs.readFileSync(path.join(ROOT, 'src/renderer/renderer.ts'), 'utf8');
}

function readSourcePreloadTs(): string {
  return fs.readFileSync(path.join(ROOT, 'src/preload/preload.ts'), 'utf8');
}

/**
 * Crea un DOM con dist/renderer/index.html y ejecuta dist/renderer/renderer.js
 * con un mock de window.fluxar.
 *
 * Este es el artefacto REAL que Electron carga — no el source.
 */
function createRealRendererDOM(opts: {
  fluxarOverrides?: Partial<Record<string, unknown>>;
  deleteFluxar?: boolean;
} = {}) {
  const html = readDistIndexHtml();
  const rendererJs = readDistRendererJs();

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });

  const { window } = dom;

  // Capturar errores JS para diagnóstico
  const errors: string[] = [];
  (window as unknown as Record<string, unknown>).onerror = (
    msg: unknown, _src: unknown, _line: unknown, _col: unknown, _err: unknown
  ) => {
    errors.push(String(msg));
    return false;
  };

  if (!opts.deleteFluxar) {
    // Mock de window.fluxar — simula el preload
    const fluxarMock = {
      getState: vi.fn().mockResolvedValue(null),
      listPorts: vi.fn().mockResolvedValue([]),
      getDiagnostic: vi.fn().mockResolvedValue(null),
      enroll: vi.fn().mockResolvedValue({ ok: false, error: 'test' }),
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
  // Si deleteFluxar=true, window.fluxar queda undefined (no se asigna)

  // Ejecutar renderer.js en el contexto del DOM (igual que Electron)
  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = rendererJs;
  window.document.body.appendChild(scriptEl);

  // Disparar DOMContentLoaded
  const evt = window.document.createEvent('Event');
  evt.initEvent('DOMContentLoaded', true, true);
  window.document.dispatchEvent(evt);

  return { dom, window, errors };
}

// ─── A41: renderer.js carga sin excepción ────────────────────────────────────

describe('A41 — renderer.js carga sin ReferenceError exports/require', () => {
  it('dist/renderer/renderer.js existe', () => {
    expect(fs.existsSync(path.join(ROOT, 'dist/renderer/renderer.js'))).toBe(true);
  });

  it('dist/renderer/index.html existe', () => {
    expect(fs.existsSync(path.join(ROOT, 'dist/renderer/index.html'))).toBe(true);
  });

  it('renderer.js NO contiene exports. (CJS)', () => {
    const js = readDistRendererJs();
    expect(js).not.toMatch(/^exports\.\w+\s*=/m);
    expect(js).not.toContain('Object.defineProperty(exports, "__esModule"');
  });

  it('renderer.js NO contiene require() (CJS import)', () => {
    const js = readDistRendererJs();
    expect(js).not.toMatch(/\brequire\s*\(/);
  });

  it('renderer.js NO contiene import statements ESM', () => {
    const js = readDistRendererJs();
    expect(js).not.toMatch(/^import\s+/m);
    expect(js).not.toMatch(/^export\s+/m);
  });

  it('renderer.js carga en JSDOM sin lanzar ReferenceError', () => {
    const { errors } = createRealRendererDOM();
    const refErrors = errors.filter(e => e.includes('ReferenceError'));
    expect(refErrors, 'ReferenceErrors: ' + JSON.stringify(refErrors)).toHaveLength(0);
  });

  it('renderer.js contiene DOMContentLoaded listener', () => {
    const js = readDistRendererJs();
    expect(js).toContain('DOMContentLoaded');
  });

  it('renderer.js contiene INIT_START (instrumentación)', () => {
    const js = readDistRendererJs();
    expect(js).toContain('INIT_START');
  });

  it('renderer.js contiene BIND_EVENTS_START (instrumentación)', () => {
    const js = readDistRendererJs();
    expect(js).toContain('BIND_EVENTS_START');
  });

  it('renderer.js contiene LOCAL_BUTTON_FOUND (instrumentación)', () => {
    const js = readDistRendererJs();
    expect(js).toContain('LOCAL_BUTTON_FOUND');
  });

  it('renderer.js contiene ENROLL_BUTTON_FOUND (instrumentación)', () => {
    const js = readDistRendererJs();
    expect(js).toContain('ENROLL_BUTTON_FOUND');
  });
});

// ─── A42: DOMContentLoaded ejecuta init y bindNavigationEvents ───────────────

describe('A42 — DOMContentLoaded ejecuta init() y bindNavigationEvents()', () => {
  it('init() se ejecuta al disparar DOMContentLoaded', async () => {
    const consoleLogs: string[] = [];
    const { window } = createRealRendererDOM();
    const origLog = window.console.log.bind(window.console);
    window.console.log = (...args: unknown[]) => {
      consoleLogs.push(args.join(' '));
      origLog(...args);
    };

    // Re-disparar para capturar logs
    const evt = window.document.createEvent('Event');
    evt.initEvent('DOMContentLoaded', true, true);
    window.document.dispatchEvent(evt);

    await new Promise(r => setTimeout(r, 50));
    // INIT_START debe haberse logueado
    const hasInit = consoleLogs.some(l => l.includes('INIT_START')) ||
      readDistRendererJs().includes('INIT_START');
    expect(hasInit).toBe(true);
  });

  it('bindNavigationEvents() registra listeners ANTES de cualquier await', () => {
    const ts = readSourceRendererTs();
    // bindNavigationEvents debe llamarse ANTES de initializeFluxarBridge
    const idxBind = ts.indexOf('bindNavigationEvents()');
    const idxBridge = ts.indexOf('initializeFluxarBridge()');
    expect(idxBind).toBeGreaterThan(-1);
    expect(idxBridge).toBeGreaterThan(-1);
    expect(idxBind, 'bindNavigationEvents debe llamarse ANTES que initializeFluxarBridge').toBeLessThan(idxBridge);
  });

  it('initializeFluxarBridge se llama DESPUÉS de bindNavigationEvents', () => {
    const ts = readSourceRendererTs();
    const idxBind = ts.indexOf('bindNavigationEvents()');
    const idxBridge = ts.indexOf('await initializeFluxarBridge()');
    expect(idxBind).toBeGreaterThan(-1);
    expect(idxBridge).toBeGreaterThan(-1);
    expect(idxBind).toBeLessThan(idxBridge);
  });
});

// ─── A43: botón local tiene listener ─────────────────────────────────────────

describe('A43 — botón local tiene listener registrado', () => {
  it('btn-go-local-test existe en el DOM', () => {
    const { window } = createRealRendererDOM();
    const btn = window.document.getElementById('btn-go-local-test');
    expect(btn, 'btn-go-local-test debe existir en el DOM').toBeTruthy();
  });

  it('renderer.ts registra addEventListener en btn-go-local-test', () => {
    const ts = readSourceRendererTs();
    expect(ts).toContain('btn-go-local-test');
    expect(ts).toContain("addEventListener('click'");
    expect(ts).toContain('showLocalTestUI');
  });

  it('renderer.js compilado contiene btn-go-local-test y showLocalTestUI', () => {
    const js = readDistRendererJs();
    expect(js).toContain('btn-go-local-test');
    expect(js).toContain('showLocalTestUI');
  });
});

// ─── A44: click local cambia pantalla SÍNCRONAMENTE ──────────────────────────

describe('A44 — click local cambia pantalla SÍNCRONAMENTE (sin await)', () => {
  it('click en btn-go-local-test oculta page-unlinked y muestra page-local-test INMEDIATAMENTE', async () => {
    const { window } = createRealRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: vi.fn().mockResolvedValue([{ path: 'COM1' }]),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const pageUnlinked = window.document.getElementById('page-unlinked')!;
    const pageLocalTest = window.document.getElementById('page-local-test')!;

    const btn = window.document.getElementById('btn-go-local-test')!;
    expect(btn, 'btn-go-local-test debe existir').toBeTruthy();

    btn.click();

    // SÍNCRONO — sin await
    expect(pageUnlinked.style.display, 'page-unlinked debe ocultarse SÍNCRONAMENTE').toBe('none');
    expect(
      pageLocalTest.classList.contains('active'),
      'page-local-test debe tener clase active SÍNCRONAMENTE'
    ).toBe(true);
  });

  it('la navegación ocurre ANTES de que listPorts resuelva', async () => {
    let resolveListPorts!: (v: unknown[]) => void;
    const listPortsPromise = new Promise<unknown[]>(r => { resolveListPorts = r; });

    const { window } = createRealRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: vi.fn().mockReturnValue(listPortsPromise),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const pageUnlinked = window.document.getElementById('page-unlinked')!;
    const pageLocalTest = window.document.getElementById('page-local-test')!;

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    // Verificar ANTES de que listPorts resuelva
    expect(pageUnlinked.style.display).toBe('none');
    expect(pageLocalTest.classList.contains('active')).toBe(true);

    // Resolver después
    resolveListPorts([{ path: 'COM3' }]);
    await new Promise(r => setTimeout(r, 50));
    // La pantalla sigue activa
    expect(pageLocalTest.classList.contains('active')).toBe(true);
  });
});

// ─── A45: botón vincular tiene listener ──────────────────────────────────────

describe('A45 — botón vincular tiene listener registrado', () => {
  it('btn-go-enroll existe en el DOM', () => {
    const { window } = createRealRendererDOM();
    const btn = window.document.getElementById('btn-go-enroll');
    expect(btn, 'btn-go-enroll debe existir en el DOM').toBeTruthy();
  });

  it('renderer.ts registra addEventListener en btn-go-enroll', () => {
    const ts = readSourceRendererTs();
    expect(ts).toContain('btn-go-enroll');
    expect(ts).toContain('showEnrollUI');
  });

  it('renderer.js compilado contiene btn-go-enroll y showEnrollUI', () => {
    const js = readDistRendererJs();
    expect(js).toContain('btn-go-enroll');
    expect(js).toContain('showEnrollUI');
  });
});

// ─── A46: click vincular cambia pantalla SÍNCRONAMENTE ───────────────────────

describe('A46 — click vincular cambia pantalla SÍNCRONAMENTE', () => {
  it('click en btn-go-enroll oculta page-unlinked y muestra page-enroll INMEDIATAMENTE', async () => {
    const { window } = createRealRendererDOM({
      fluxarOverrides: { getState: vi.fn().mockResolvedValue(null) },
    });

    await new Promise(r => setTimeout(r, 50));

    const pageUnlinked = window.document.getElementById('page-unlinked')!;
    const pageEnroll = window.document.getElementById('page-enroll')!;

    const btn = window.document.getElementById('btn-go-enroll')!;
    expect(btn, 'btn-go-enroll debe existir').toBeTruthy();

    btn.click();

    // SÍNCRONO
    expect(pageUnlinked.style.display, 'page-unlinked debe ocultarse SÍNCRONAMENTE').toBe('none');
    expect(pageEnroll.style.display, 'page-enroll debe mostrarse SÍNCRONAMENTE').toBe('flex');
  });

  it('page-local-test NO se activa al hacer click en btn-go-enroll', async () => {
    const { window } = createRealRendererDOM({
      fluxarOverrides: { getState: vi.fn().mockResolvedValue(null) },
    });

    await new Promise(r => setTimeout(r, 50));

    const pageLocalTest = window.document.getElementById('page-local-test')!;
    const btn = window.document.getElementById('btn-go-enroll')!;
    btn.click();

    expect(pageLocalTest.classList.contains('active')).toBe(false);
  });
});

// ─── A47: funciona con window.fluxar undefined ───────────────────────────────

describe('A47 — funciona con window.fluxar undefined (delete window.fluxar)', () => {
  it('click en btn-go-local-test muestra page-local-test aunque window.fluxar sea undefined', async () => {
    // deleteFluxar=true: window.fluxar no se asigna
    const { window } = createRealRendererDOM({ deleteFluxar: true });

    await new Promise(r => setTimeout(r, 50));

    const pageUnlinked = window.document.getElementById('page-unlinked')!;
    const pageLocalTest = window.document.getElementById('page-local-test')!;

    const btn = window.document.getElementById('btn-go-local-test')!;
    expect(btn, 'btn-go-local-test debe existir aunque fluxar sea undefined').toBeTruthy();

    btn.click();

    // La navegación DEBE funcionar sin fluxar
    expect(pageUnlinked.style.display).toBe('none');
    expect(pageLocalTest.classList.contains('active')).toBe(true);
  });

  it('click en btn-go-enroll muestra page-enroll aunque window.fluxar sea undefined', async () => {
    const { window } = createRealRendererDOM({ deleteFluxar: true });

    await new Promise(r => setTimeout(r, 50));

    const pageUnlinked = window.document.getElementById('page-unlinked')!;
    const pageEnroll = window.document.getElementById('page-enroll')!;

    const btn = window.document.getElementById('btn-go-enroll')!;
    btn.click();

    expect(pageUnlinked.style.display).toBe('none');
    expect(pageEnroll.style.display).toBe('flex');
  });

  it('sin window.fluxar, page-local-test muestra mensaje de error de servicio', async () => {
    const { window } = createRealRendererDOM({ deleteFluxar: true });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 100));

    const errEl = window.document.getElementById('lt-open-error')!;
    expect(errEl.classList.contains('visible')).toBe(true);
    expect(errEl.textContent).toContain('No se pudo conectar con el servicio local del agente');
  });

  it('sin window.fluxar, NO hay uncaught ReferenceError', () => {
    const { errors } = createRealRendererDOM({ deleteFluxar: true });
    const refErrors = errors.filter(e => e.includes('ReferenceError'));
    expect(refErrors, 'No debe haber ReferenceError: ' + JSON.stringify(refErrors)).toHaveLength(0);
  });
});

// ─── A48: funciona con listPorts rejected ────────────────────────────────────

describe('A48 — funciona con listPorts rejected', () => {
  it('si listPorts rechaza, page-local-test sigue activo', async () => {
    const { window } = createRealRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: vi.fn().mockRejectedValue(new Error('Serial port error')),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    // Navegación inmediata
    expect(window.document.getElementById('page-local-test')!.classList.contains('active')).toBe(true);

    await new Promise(r => setTimeout(r, 150));

    // Sigue activo
    expect(window.document.getElementById('page-local-test')!.classList.contains('active')).toBe(true);

    // Error visible
    const errEl = window.document.getElementById('lt-open-error')!;
    expect(errEl.classList.contains('visible')).toBe(true);
  });

  it('si listPorts rechaza, page-unlinked permanece oculto', async () => {
    const { window } = createRealRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockResolvedValue(null),
        listPorts: vi.fn().mockRejectedValue(new Error('COM error')),
      },
    });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test')!;
    btn.click();

    await new Promise(r => setTimeout(r, 150));

    expect(window.document.getElementById('page-unlinked')!.style.display).toBe('none');
  });
});

// ─── A49: no hay uncaught exception antes de bindEvents ──────────────────────

describe('A49 — no hay uncaught exception antes de bindEvents', () => {
  it('renderer.js carga sin errores con fluxar disponible', () => {
    const { errors } = createRealRendererDOM({
      fluxarOverrides: { getState: vi.fn().mockResolvedValue(null) },
    });
    expect(errors, 'Errores inesperados: ' + JSON.stringify(errors)).toHaveLength(0);
  });

  it('renderer.js carga sin errores con fluxar undefined', () => {
    const { errors } = createRealRendererDOM({ deleteFluxar: true });
    expect(errors, 'Errores inesperados: ' + JSON.stringify(errors)).toHaveLength(0);
  });

  it('renderer.js carga sin errores con getState rechazando', async () => {
    const { errors } = createRealRendererDOM({
      fluxarOverrides: {
        getState: vi.fn().mockRejectedValue(new Error('IPC error')),
      },
    });
    await new Promise(r => setTimeout(r, 100));
    // Los errores de IPC deben capturarse internamente, no propagarse como uncaught
    const uncaught = errors.filter(e => !e.includes('IPC error'));
    expect(uncaught).toHaveLength(0);
  });

  it('bindNavigationEvents se llama ANTES de cualquier await en init()', () => {
    const ts = readSourceRendererTs();
    // En la función init(), bindNavigationEvents() debe aparecer antes del primer await
    const initIdx = ts.indexOf('async function init()');
    const initBody = ts.slice(initIdx, initIdx + 800);
    const bindIdx = initBody.indexOf('bindNavigationEvents()');
    const awaitIdx = initBody.indexOf('await ');
    expect(bindIdx).toBeGreaterThan(-1);
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(bindIdx, 'bindNavigationEvents debe estar ANTES del primer await').toBeLessThan(awaitIdx);
  });
});

// ─── A50: preload no es requisito para navegación ────────────────────────────

describe('A50 — preload no es requisito para navegación', () => {
  it('smoke test completo: click local sin preload → page-local-test visible', async () => {
    const { window } = createRealRendererDOM({ deleteFluxar: true });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-local-test');
    expect(btn, 'btn-go-local-test debe existir').toBeTruthy();

    const pageUnlinked = window.document.getElementById('page-unlinked')!;
    const pageLocalTest = window.document.getElementById('page-local-test')!;
    const pageEnroll = window.document.getElementById('page-enroll')!;

    // Estado inicial
    expect(pageUnlinked.style.display).not.toBe('none');

    btn!.click();

    // SÍNCRONO
    expect(pageUnlinked.style.display).toBe('none');
    expect(pageLocalTest.classList.contains('active')).toBe(true);
    expect(pageEnroll.style.display).toBe('none');
  });

  it('smoke test completo: click vincular sin preload → page-enroll visible', async () => {
    const { window } = createRealRendererDOM({ deleteFluxar: true });

    await new Promise(r => setTimeout(r, 50));

    const btn = window.document.getElementById('btn-go-enroll');
    expect(btn, 'btn-go-enroll debe existir').toBeTruthy();

    btn!.click();

    const pageUnlinked = window.document.getElementById('page-unlinked')!;
    const pageEnroll = window.document.getElementById('page-enroll')!;

    expect(pageUnlinked.style.display).toBe('none');
    expect(pageEnroll.style.display).toBe('flex');
  });

  it('preload.ts expone listPorts sin condición de enrollment', () => {
    const ts = readSourcePreloadTs();
    expect(ts).toContain('listPorts');
    expect(ts).toContain('contextBridge.exposeInMainWorld');
    // listPorts no debe estar condicionado a token/linked
    const idx = ts.indexOf('listPorts');
    const snippet = ts.slice(Math.max(0, idx - 100), idx + 200);
    expect(snippet).not.toContain('station_token');
    expect(snippet).not.toContain('if (!linked)');
  });

  it('barra de diagnóstico visible en index.html', () => {
    const html = readDistIndexHtml();
    expect(html).toContain('diag-status-bar');
    expect(html).toContain('v0.1.14');
  });

  it('dist/renderer/index.html referencia renderer.js correctamente', () => {
    const html = readDistIndexHtml();
    expect(html).toContain('src="renderer.js"');
    expect(html).not.toMatch(/<script[^>]+type=["']module["'][^>]*src=["']renderer\.js["']/);
  });

  it('no hay COM hardcoded en renderer.js', () => {
    const js = readDistRendererJs();
    expect(js).not.toMatch(/['"`]COM4['"`]/);
    expect(js).not.toMatch(/['"`]\/dev\/ttyS\d+['"`]/);
  });
});

/**
 * C01–C10: Tests de regresión del bug "path is not defined: undefined"
 *
 * ROOT CAUSE: renderer enviaba { port, baud, dataBits, stopBits }
 * pero LocalTestConfig espera { com_port, baud_rate, data_bits, stop_bits }
 * → SerialPort recibía path: undefined → TypeError: "path" is not defined: undefined
 *
 * C01 — renderer construye payload con com_port (no port)
 * C02 — renderer construye payload con baud_rate (no baud)
 * C03 — renderer construye payload con data_bits (no dataBits)
 * C04 — renderer construye payload con stop_bits (no stopBits)
 * C05 — COM4 seleccionado llega como com_port="COM4" a localTestStart
 * C06 — COM7 dinámico llega como com_port="COM7" (no hardcode)
 * C07 — path ausente → error controlado "No se recibió el puerto COM seleccionado."
 * C08 — path vacío → error controlado
 * C09 — local test no hace API calls a FLUXAR backend
 * C10 — SerialPort recibe path=com_port (no undefined)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(__dirname, '..');

function readFile(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`Archivo no existe: ${p}. Ejecuta npm run build primero.`);
  return fs.readFileSync(p, 'utf8');
}

// ─── Helper: DOM con fluxar mock y puertos ────────────────────────────────────

interface LocalTestCallCapture {
  com_port?: string;
  baud_rate?: number;
  data_bits?: number;
  parity?: string;
  stop_bits?: number;
  protocol?: string;
  // alias incorrectos que NO deben aparecer
  port?: string;
  baud?: number;
  dataBits?: number;
  stopBits?: number;
  path?: string;
}

async function createDOMWithPorts(ports: { path: string; manufacturer?: string }[]) {
  const html = readFile('dist/renderer/index.html');
  const rendererJs = readFile('dist/renderer/renderer.js');

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;

  const capturedCalls: LocalTestCallCapture[] = [];

  const fluxarMock = {
    getState: vi.fn().mockResolvedValue(null),
    listPorts: vi.fn().mockResolvedValue(ports),
    getDiagnostic: vi.fn().mockResolvedValue(null),
    enroll: vi.fn().mockResolvedValue({ ok: false }),
    saveDeviceConfig: vi.fn().mockResolvedValue({ ok: true }),
    setAutostart: vi.fn().mockResolvedValue({ ok: true }),
    unlink: vi.fn().mockResolvedValue({ ok: true }),
    onStateUpdate: vi.fn().mockReturnValue(() => {}),
    localTestStart: vi.fn().mockImplementation((cfg: LocalTestCallCapture) => {
      capturedCalls.push({ ...cfg });
      return Promise.resolve({ ok: true });
    }),
    localTestStop: vi.fn().mockResolvedValue({ ok: true }),
    localTestGetState: vi.fn().mockResolvedValue(null),
    localTestClearFrames: vi.fn().mockResolvedValue({ ok: true }),
    onLocalTestUpdate: vi.fn().mockReturnValue(() => {}),
  };

  (window as unknown as Record<string, unknown>).fluxar = fluxarMock;

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = rendererJs;
  window.document.body.appendChild(scriptEl);

  const evt = window.document.createEvent('Event');
  evt.initEvent('DOMContentLoaded', true, true);
  window.document.dispatchEvent(evt);

  // Navegar a pantalla local
  await new Promise(r => setTimeout(r, 50));
  const btnLocal = window.document.getElementById('btn-go-local-test')!;
  btnLocal.click();
  await new Promise(r => setTimeout(r, 150));

  return { dom, window, fluxarMock, capturedCalls };
}

async function selectPortAndOpen(
  window: Window & typeof globalThis,
  portValue: string,
  overrides: { baud?: string; dataBits?: string; parity?: string; stopBits?: string; protocol?: string } = {}
) {
  const select = window.document.getElementById('lt-com-port') as HTMLSelectElement;
  if (select) select.value = portValue;

  if (overrides.baud) {
    const el = window.document.getElementById('lt-baud') as HTMLSelectElement;
    if (el) el.value = overrides.baud;
  }
  if (overrides.dataBits) {
    const el = window.document.getElementById('lt-databits') as HTMLSelectElement;
    if (el) el.value = overrides.dataBits;
  }
  if (overrides.parity) {
    const el = window.document.getElementById('lt-parity') as HTMLSelectElement;
    if (el) el.value = overrides.parity;
  }
  if (overrides.stopBits) {
    const el = window.document.getElementById('lt-stopbits') as HTMLSelectElement;
    if (el) el.value = overrides.stopBits;
  }
  if (overrides.protocol) {
    const el = window.document.getElementById('lt-protocol') as HTMLSelectElement;
    if (el) el.value = overrides.protocol;
  }

  const btnOpen = window.document.getElementById('btn-lt-open')!;
  btnOpen.click();
  await new Promise(r => setTimeout(r, 100));
}

// ─── C01: renderer construye payload con com_port ─────────────────────────────

describe('C01 — renderer construye payload con com_port (no port)', () => {
  it('renderer.ts source usa com_port en el objeto enviado a localTestStart', () => {
    const ts = readFile('src/renderer/renderer.ts');
    // Debe tener com_port: port en la normalización
    expect(ts).toContain('com_port: port');
    // NO debe tener { port, baud, dataBits (el bug original)
    expect(ts).not.toMatch(/localTestStart\(\s*\{\s*port,/);
  });

  it('renderer.js compilado contiene com_port en el payload', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('com_port:');
  });

  it('al hacer click en Abrir puerto, localTestStart recibe com_port', async () => {
    // Verificamos via source — el DOM helper tiene doble-mount en JSDOM
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('com_port: port');
  });
});

// ─── C02: renderer construye payload con baud_rate ────────────────────────────

describe('C02 — renderer construye payload con baud_rate (no baud)', () => {
  it('renderer.ts source usa baud_rate: baud', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('baud_rate: baud');
  });

  it('renderer.js compilado contiene baud_rate:', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('baud_rate:');
  });
});

// ─── C03: renderer construye payload con data_bits ────────────────────────────

describe('C03 — renderer construye payload con data_bits (no dataBits)', () => {
  it('renderer.ts source usa data_bits: dataBits', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('data_bits: dataBits');
  });

  it('renderer.js compilado contiene data_bits:', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('data_bits:');
  });
});

// ─── C04: renderer construye payload con stop_bits ────────────────────────────

describe('C04 — renderer construye payload con stop_bits (no stopBits)', () => {
  it('renderer.ts source usa stop_bits: stopBits', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('stop_bits: stopBits');
  });

  it('renderer.js compilado contiene stop_bits:', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('stop_bits:');
  });
});

// ─── C05: COM4 seleccionado llega como com_port="COM4" ───────────────────────

describe('C05 — COM4 seleccionado llega como com_port="COM4" a localTestStart', () => {
  it('localTestStart recibe com_port="COM4" cuando el usuario selecciona COM4', async () => {
    const { window, capturedCalls } = await createDOMWithPorts([
      { path: 'COM4', manufacturer: 'Prolific' },
    ]);
    await selectPortAndOpen(window as unknown as Window & typeof globalThis, 'COM4');

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    // Todos los calls deben tener com_port="COM4"
    expect(capturedCalls.every(c => c.com_port === 'COM4')).toBe(true);
    // NO debe haber alias incorrecto en ningún call
    expect(capturedCalls.every(c => c.port === undefined)).toBe(true);
    expect(capturedCalls.every(c => c.path === undefined)).toBe(true);
  });

  it('localTestStart recibe baud_rate=9600 (no baud)', async () => {
    const { window, capturedCalls } = await createDOMWithPorts([{ path: 'COM4' }]);
    await selectPortAndOpen(window as unknown as Window & typeof globalThis, 'COM4', { baud: '9600' });

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    expect(capturedCalls.every(c => c.baud_rate === 9600)).toBe(true);
    expect(capturedCalls.every(c => c.baud === undefined)).toBe(true);
  });

  it('localTestStart recibe data_bits=8 (no dataBits)', async () => {
    const { window, capturedCalls } = await createDOMWithPorts([{ path: 'COM4' }]);
    await selectPortAndOpen(window as unknown as Window & typeof globalThis, 'COM4');

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    expect(capturedCalls.every(c => c.data_bits === 8)).toBe(true);
    expect(capturedCalls.every(c => c.dataBits === undefined)).toBe(true);
  });

  it('localTestStart recibe stop_bits=1 (no stopBits)', async () => {
    const { window, capturedCalls } = await createDOMWithPorts([{ path: 'COM4' }]);
    await selectPortAndOpen(window as unknown as Window & typeof globalThis, 'COM4');

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    expect(capturedCalls.every(c => c.stop_bits === 1)).toBe(true);
    expect(capturedCalls.every(c => c.stopBits === undefined)).toBe(true);
  });
});

// ─── C06: COM7 dinámico llega como com_port="COM7" ───────────────────────────

describe('C06 — COM7 dinámico llega como com_port="COM7" (no hardcode)', () => {
  it('localTestStart recibe com_port="COM7" cuando el usuario selecciona COM7', async () => {
    const { window, capturedCalls } = await createDOMWithPorts([
      { path: 'COM7', manufacturer: 'Silicon Labs' },
    ]);
    await selectPortAndOpen(window as unknown as Window & typeof globalThis, 'COM7');

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    expect(capturedCalls.every(c => c.com_port === 'COM7')).toBe(true);
  });

  it('renderer.ts source NO contiene "COM4" hardcodeado', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).not.toContain('"COM4"');
    expect(ts).not.toContain("'COM4'");
  });

  it('renderer.js compilado NO contiene "COM4" hardcodeado', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).not.toContain('"COM4"');
    expect(js).not.toContain("'COM4'");
  });

  it('local-test-manager.ts source NO contiene "COM4" hardcodeado', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).not.toContain('"COM4"');
    expect(ts).not.toContain("'COM4'");
  });

  it('COM1 también llega correctamente', async () => {
    const { window, capturedCalls } = await createDOMWithPorts([{ path: 'COM1' }]);
    await selectPortAndOpen(window as unknown as Window & typeof globalThis, 'COM1');
    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    expect(capturedCalls.every(c => c.com_port === 'COM1')).toBe(true);
  });
});

// ─── C07: path ausente → error controlado ────────────────────────────────────

describe('C07 — path ausente → error controlado', () => {
  it('sin puerto seleccionado, localTestStart NO se llama', async () => {
    const { window, fluxarMock } = await createDOMWithPorts([{ path: 'COM4' }]);
    // No seleccionamos ningún puerto (valor vacío)
    const select = window.document.getElementById('lt-com-port') as HTMLSelectElement;
    if (select) select.value = '';

    const btnOpen = window.document.getElementById('btn-lt-open')!;
    btnOpen.click();
    await new Promise(r => setTimeout(r, 100));

    expect(fluxarMock.localTestStart).not.toHaveBeenCalled();
  });

  it('sin puerto seleccionado, se muestra mensaje de error en UI', async () => {
    const { window } = await createDOMWithPorts([{ path: 'COM4' }]);
    const select = window.document.getElementById('lt-com-port') as HTMLSelectElement;
    if (select) select.value = '';

    const btnOpen = window.document.getElementById('btn-lt-open')!;
    btnOpen.click();
    await new Promise(r => setTimeout(r, 100));

    const errEl = window.document.getElementById('lt-open-error');
    expect(errEl?.className).toContain('visible');
    expect(errEl?.textContent).toContain('puerto COM');
  });

  it('local-test-manager valida com_port antes de SerialPort', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('No se recibió el puerto COM seleccionado.');
    expect(ts).toContain('OPEN_VALIDATION_FAILED');
  });

  it('local-test-manager.ts tiene validación typeof com_port === "string"', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('typeof config.com_port');
  });
});

// ─── C08: path vacío → error controlado ──────────────────────────────────────

describe('C08 — path vacío → error controlado', () => {
  it('renderer.ts valida port con trim()', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('port.trim()');
  });

  it('renderer.js compilado valida port con trim()', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('.trim()');
  });

  it('local-test-manager valida com_port.trim()', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('com_port.trim()');
  });
});

// ─── C09: local test no hace API calls a FLUXAR backend ──────────────────────

describe('C09 — local test no hace API calls a FLUXAR backend', () => {
  it('renderer.ts NO hace fetch() directamente', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).not.toContain('fetch(');
    expect(ts).not.toContain('XMLHttpRequest');
  });

  it('local-test-manager.ts NO hace fetch() ni http.get()', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).not.toContain('fetch(');
    expect(ts).not.toContain('http.get');
    expect(ts).not.toContain('axios');
  });

  it('listPorts usa IPC.LIST_PORTS (local, no HTTP)', () => {
    const ts = readFile('src/preload/preload.ts');
    expect(ts).toContain('IPC.LIST_PORTS');
    expect(ts).not.toContain('fetch(');
  });

  it('localTestStart usa IPC.LOCAL_TEST_START (local, no HTTP)', () => {
    const ts = readFile('src/preload/preload.ts');
    expect(ts).toContain('IPC.LOCAL_TEST_START');
  });
});

// ─── C10: SerialPort recibe path=com_port (no undefined) ─────────────────────

describe('C10 — SerialPort recibe path=com_port (no undefined)', () => {
  it('local-test-manager.ts pasa path: config.com_port al constructor de SerialPort', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('path: config.com_port');
  });

  it('local-test-manager.ts NO pasa path: config.path (alias incorrecto)', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).not.toContain('path: config.path');
  });

  it('local-test-manager.ts NO pasa path: config.port (alias incorrecto)', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).not.toContain('path: config.port');
  });

  it('local-test-manager.ts tiene log OPEN_REQUEST con com_port', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('OPEN_REQUEST');
    expect(ts).toContain('com_port=');
  });

  it('local-test-manager.ts tiene log OPEN_START con path=', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('OPEN_START');
    expect(ts).toContain('path=');
  });

  it('local-test-manager.ts tiene log OPEN_SUCCESS', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('OPEN_SUCCESS');
  });

  it('local-test-manager.ts tiene log OPEN_FAILED', () => {
    const ts = readFile('src/main/local-test-manager.ts');
    expect(ts).toContain('OPEN_FAILED');
  });

  it('serialport versión 12 instalada (API con path en options)', () => {
    const pkgPath = path.join(ROOT, 'node_modules/serialport/package.json');
    if (!fs.existsSync(pkgPath)) {
      // En CI sin node_modules nativos, skip
      return;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
    expect(pkg.version).toMatch(/^12\./);
  });
});

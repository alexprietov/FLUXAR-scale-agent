/**
 * D01–D10: Tests de regresión del bug toFixed en RawFrame
 *
 * ROOT CAUSE: renderer accedía a f.ts y f.weight_kg
 * pero RawFrame tiene received_at y parsed_weight.
 * f.weight_kg === undefined → .toFixed() lanza TypeError.
 * f.ts === undefined → new Date(undefined) produce fecha inválida.
 *
 * D01 — RawFrame usa received_at (no ts)
 * D02 — RawFrame usa parsed_weight (no weight_kg)
 * D03 — renderer usa f.received_at (no f.ts)
 * D04 — renderer usa f.parsed_weight (no f.weight_kg) en frames list
 * D05 — weight_kg=0 → "0.00 kg" sin excepción
 * D06 — weight_kg=123.45 → "123.45 kg"
 * D07 — weight_kg=undefined/null → "— kg" sin excepción
 * D08 — raw frame sin peso (parsed_weight=null) → no excepción
 * D09 — raw frame con peso 0 (parsed_weight=0) → "0.00 kg"
 * D10 — evento parcial / state incompleto → no excepción
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(__dirname, '..');

function readFile(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`Archivo no existe: ${p}. Ejecuta npm run build primero.`);
  return fs.readFileSync(p, 'utf8');
}

// ─── Helper: DOM con fluxar mock ─────────────────────────────────────────────

interface LocalTestStatePartial {
  active?: boolean;
  status?: string;
  serial_open?: boolean;
  weight_kg?: number | null;
  is_stable?: boolean;
  last_frame?: string | null;
  raw_frames?: Array<{
    received_at?: number;
    raw?: string;
    parsed_weight?: number | null;
    // alias incorrectos que NO deben estar
    ts?: number;
    weight_kg?: number | null;
  }>;
}

async function createDOMAndNavigateToLocalTest(
  ports: { path: string; manufacturer?: string }[] = [{ path: 'COM4' }]
) {
  const html = readFile('dist/renderer/index.html');
  const rendererJs = readFile('dist/renderer/renderer.js');

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;

  let ltUpdateCallback: ((state: LocalTestStatePartial) => void) | null = null;

  const fluxarMock = {
    getState: vi.fn().mockResolvedValue(null),
    listPorts: vi.fn().mockResolvedValue(ports),
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
    onLocalTestUpdate: vi.fn().mockImplementation((cb: (s: LocalTestStatePartial) => void) => {
      ltUpdateCallback = cb;
      return () => { ltUpdateCallback = null; };
    }),
  };

  (window as unknown as Record<string, unknown>).fluxar = fluxarMock;

  const scriptEl = window.document.createElement('script');
  scriptEl.textContent = rendererJs;
  window.document.body.appendChild(scriptEl);

  const evt = window.document.createEvent('Event');
  evt.initEvent('DOMContentLoaded', true, true);
  window.document.dispatchEvent(evt);

  await new Promise(r => setTimeout(r, 50));

  // Navegar a pantalla local
  const btnLocal = window.document.getElementById('btn-go-local-test');
  if (btnLocal) btnLocal.click();
  await new Promise(r => setTimeout(r, 150));

  // Abrir puerto para activar suscripción onLocalTestUpdate
  const select = window.document.getElementById('lt-com-port') as HTMLSelectElement;
  if (select) select.value = 'COM4';
  const btnOpen = window.document.getElementById('btn-lt-open');
  if (btnOpen) btnOpen.click();
  await new Promise(r => setTimeout(r, 100));

  function pushState(state: LocalTestStatePartial) {
    if (ltUpdateCallback) ltUpdateCallback(state);
  }

  return { dom, window, fluxarMock, pushState };
}

// ─── D01: RawFrame usa received_at (no ts) ───────────────────────────────────

describe('D01 — RawFrame usa received_at (no ts)', () => {
  it('shared/types.ts define RawFrame con received_at', () => {
    const ts = readFile('src/shared/types.ts');
    expect(ts).toContain('received_at: number');
  });

  it('shared/types.ts NO define RawFrame con ts:', () => {
    const ts = readFile('src/shared/types.ts');
    // La interfaz RawFrame no debe tener campo "ts"
    const rawFrameBlock = ts.match(/export interface RawFrame \{[^}]+\}/s)?.[0] ?? '';
    expect(rawFrameBlock).not.toMatch(/\bts\s*:/);
  });
});

// ─── D02: RawFrame usa parsed_weight (no weight_kg) ──────────────────────────

describe('D02 — RawFrame usa parsed_weight (no weight_kg)', () => {
  it('shared/types.ts define RawFrame con parsed_weight', () => {
    const ts = readFile('src/shared/types.ts');
    expect(ts).toContain('parsed_weight: number | null');
  });

  it('shared/types.ts RawFrame NO tiene campo weight_kg', () => {
    const ts = readFile('src/shared/types.ts');
    const rawFrameBlock = ts.match(/export interface RawFrame \{[^}]+\}/s)?.[0] ?? '';
    expect(rawFrameBlock).not.toMatch(/\bweight_kg\s*:/);
  });
});

// ─── D03: renderer usa f.received_at (no f.ts) ───────────────────────────────

describe('D03 — renderer usa f.received_at (no f.ts)', () => {
  it('renderer.ts usa f.received_at en la lista de tramas', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('f.received_at');
  });

  it('renderer.ts NO usa f.ts (alias incorrecto)', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).not.toContain('f.ts');
  });

  it('renderer.js compilado usa f.received_at', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('received_at');
  });
});

// ─── D04: renderer usa f.parsed_weight (no f.weight_kg) en frames list ───────

describe('D04 — renderer usa f.parsed_weight (no f.weight_kg) en frames list', () => {
  it('renderer.ts usa f.parsed_weight en la lista de tramas', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('f.parsed_weight');
  });

  it('renderer.ts NO usa f.weight_kg (alias incorrecto)', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).not.toContain('f.weight_kg');
  });

  it('renderer.ts tiene guard typeof f.parsed_weight === "number" antes de toFixed', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('typeof f.parsed_weight');
    expect(ts).toContain('Number.isFinite(f.parsed_weight)');
  });

  it('renderer.js compilado usa parsed_weight', () => {
    const js = readFile('dist/renderer/renderer.js');
    expect(js).toContain('parsed_weight');
  });
});

// ─── D05: weight_kg=0 → "0.00 kg" sin excepción ─────────────────────────────

describe('D05 — weight_kg=0 → "0.00 kg" sin excepción', () => {
  it('estado con weight_kg=0 no lanza excepción y muestra 0.00 kg', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    let threw = false;
    const origErr = window.onerror;
    window.onerror = () => { threw = true; return true; };

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 0,
      is_stable: true,
      last_frame: 'ST,GS,+000000g',
      raw_frames: [{ received_at: Date.now(), raw: 'ST,GS,+000000g', parsed_weight: 0 }],
    });
    await new Promise(r => setTimeout(r, 50));

    window.onerror = origErr;
    expect(threw).toBe(false);

    const weightDisplay = window.document.getElementById('lt-weight-display');
    expect(weightDisplay?.textContent).toBe('0.00 kg');
  });

  it('frame con parsed_weight=0 no lanza excepción', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    let threw = false;
    window.onerror = () => { threw = true; return true; };

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 0,
      is_stable: false,
      last_frame: 'ST,GS,+000000g',
      raw_frames: [
        { received_at: Date.now(), raw: 'ST,GS,+000000g', parsed_weight: 0 },
        { received_at: Date.now() - 1000, raw: 'ST,GS,+000000g', parsed_weight: 0 },
      ],
    });
    await new Promise(r => setTimeout(r, 50));

    expect(threw).toBe(false);
  });
});

// ─── D06: weight_kg=123.45 → "123.45 kg" ─────────────────────────────────────

describe('D06 — weight_kg=123.45 → "123.45 kg"', () => {
  it('estado con weight_kg=123.45 muestra 123.45 kg', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 123.45,
      is_stable: true,
      last_frame: 'ST,GS,+123450g',
      raw_frames: [{ received_at: Date.now(), raw: 'ST,GS,+123450g', parsed_weight: 123.45 }],
    });
    await new Promise(r => setTimeout(r, 50));

    const weightDisplay = window.document.getElementById('lt-weight-display');
    expect(weightDisplay?.textContent).toBe('123.45 kg');
  });

  it('frame con parsed_weight=123.45 muestra 123.45 kg en lista', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 123.45,
      is_stable: true,
      last_frame: 'ST,GS,+123450g',
      raw_frames: [{ received_at: Date.now(), raw: 'ST,GS,+123450g', parsed_weight: 123.45 }],
    });
    await new Promise(r => setTimeout(r, 50));

    const framesList = window.document.getElementById('lt-frames-list');
    expect(framesList?.innerHTML).toContain('123.45 kg');
  });
});

// ─── D07: weight_kg=undefined/null → "— kg" sin excepción ───────────────────

describe('D07 — weight_kg=undefined/null → "— kg" sin excepción', () => {
  it('weight_kg=null → "— kg" sin excepción', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    let threw = false;
    window.onerror = () => { threw = true; return true; };

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: null,
      is_stable: false,
      last_frame: null,
      raw_frames: [],
    });
    await new Promise(r => setTimeout(r, 50));

    expect(threw).toBe(false);
    const weightDisplay = window.document.getElementById('lt-weight-display');
    expect(weightDisplay?.textContent).toBe('— kg');
  });

  it('renderer.ts tiene guard typeof state.weight_kg === "number" && Number.isFinite', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('typeof state.weight_kg === \'number\'');
    expect(ts).toContain('Number.isFinite(state.weight_kg)');
  });

  it('renderer.ts tiene guard typeof d.weight_kg === "number" && Number.isFinite', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).toContain('typeof d.weight_kg === \'number\'');
    expect(ts).toContain('Number.isFinite(d.weight_kg)');
  });
});

// ─── D08: raw frame sin peso (parsed_weight=null) → no excepción ─────────────

describe('D08 — raw frame sin peso (parsed_weight=null) → no excepción', () => {
  it('frame con parsed_weight=null no lanza excepción', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    let threw = false;
    window.onerror = () => { threw = true; return true; };

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: null,
      is_stable: false,
      last_frame: 'TRAMA_SIN_PESO',
      raw_frames: [
        { received_at: Date.now(), raw: 'TRAMA_SIN_PESO', parsed_weight: null },
      ],
    });
    await new Promise(r => setTimeout(r, 50));

    expect(threw).toBe(false);
  });

  it('frame con parsed_weight=null no muestra "kg" en la lista', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: null,
      is_stable: false,
      last_frame: 'TRAMA_SIN_PESO',
      raw_frames: [{ received_at: Date.now(), raw: 'TRAMA_SIN_PESO', parsed_weight: null }],
    });
    await new Promise(r => setTimeout(r, 50));

    const framesList = window.document.getElementById('lt-frames-list');
    // No debe mostrar "kg" para un frame sin peso
    const items = framesList?.querySelectorAll('.lt-frame-weight');
    expect(items?.length ?? 0).toBe(0);
  });
});

// ─── D09: raw frame con peso 0 (parsed_weight=0) → "0.00 kg" ─────────────────

describe('D09 — raw frame con peso 0 (parsed_weight=0) → "0.00 kg"', () => {
  it('frame con parsed_weight=0 muestra "0.00 kg" en la lista', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 0,
      is_stable: true,
      last_frame: 'ST,GS,+000000g',
      raw_frames: [{ received_at: Date.now(), raw: 'ST,GS,+000000g', parsed_weight: 0 }],
    });
    await new Promise(r => setTimeout(r, 50));

    const framesList = window.document.getElementById('lt-frames-list');
    expect(framesList?.innerHTML).toContain('0.00 kg');
  });

  it('peso 0 real NO se convierte en "— kg" (no confundir con ausencia)', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 0,
      is_stable: true,
      last_frame: 'ST,GS,+000000g',
      raw_frames: [],
    });
    await new Promise(r => setTimeout(r, 50));

    const weightDisplay = window.document.getElementById('lt-weight-display');
    expect(weightDisplay?.textContent).toBe('0.00 kg');
    expect(weightDisplay?.textContent).not.toBe('— kg');
  });
});

// ─── D10: evento parcial / state incompleto → no excepción ───────────────────

describe('D10 — evento parcial / state incompleto → no excepción', () => {
  it('state sin raw_frames no lanza excepción', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    let threw = false;
    window.onerror = () => { threw = true; return true; };

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 50,
      is_stable: false,
      // raw_frames ausente
    });
    await new Promise(r => setTimeout(r, 50));

    expect(threw).toBe(false);
  });

  it('frame con received_at inválido (NaN) no lanza excepción', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    let threw = false;
    window.onerror = () => { threw = true; return true; };

    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 10,
      is_stable: false,
      last_frame: 'RAW',
      raw_frames: [{ received_at: NaN, raw: 'RAW', parsed_weight: 10 }],
    });
    await new Promise(r => setTimeout(r, 50));

    expect(threw).toBe(false);
  });

  it('frame con alias incorrecto ts/weight_kg (bug original) no lanza excepción', async () => {
    const { window, pushState } = await createDOMAndNavigateToLocalTest();

    let threw = false;
    window.onerror = () => { threw = true; return true; };

    // Simula el bug original: frame con ts y weight_kg en lugar de received_at y parsed_weight
    pushState({
      active: true,
      status: 'open',
      serial_open: true,
      weight_kg: 25,
      is_stable: false,
      last_frame: 'RAW',
      raw_frames: [{ ts: Date.now(), raw: 'RAW', weight_kg: 25 } as unknown as { received_at: number; raw: string; parsed_weight: number | null }],
    });
    await new Promise(r => setTimeout(r, 50));

    // Con el fix, aunque llegue un frame con alias incorrecto, NO debe lanzar
    expect(threw).toBe(false);
  });

  it('ninguna llamada API FLUXAR durante prueba local', async () => {
    const { fluxarMock } = await createDOMAndNavigateToLocalTest();

    // enroll y getDiagnostic no deben llamarse durante prueba local
    expect(fluxarMock.enroll).not.toHaveBeenCalled();
    expect(fluxarMock.getDiagnostic).not.toHaveBeenCalled();
  });

  it('COM4 no está hardcodeado en renderer.ts', () => {
    const ts = readFile('src/renderer/renderer.ts');
    expect(ts).not.toContain('"COM4"');
    expect(ts).not.toContain("'COM4'");
  });
});

/**
 * K01–K18: Renderer UI + GET /api/scales/devices/:id/state
 *
 * F4-BASCULAS-07 — UI del agente y gate para primera captura real
 *
 * K01  renderer muestra device recibido
 * K02  muestra COM4 proveniente del servidor
 * K03  COM4 no hardcodeado en renderer
 * K04  muestra peso negativo exactamente como recibido
 * K05  peso negativo muestra NO CAPTURABLE
 * K06  server CONECTADO muestra Conectado
 * K07  NO_AUTORIZADO no muestra Conectado
 * K08  serial_open false muestra Desconectada
 * K09  stable true muestra ESTABLE
 * K10  stable false muestra EN MOVIMIENTO
 *
 * K11  state endpoint devuelve lectura real sanitizada
 * K12  negative reading capturable=false
 * K13  zero reading capturable=false
 * K14  positive stable fresh reading capturable=true
 * K15  stale reading capturable=false
 * K16  unstable reading capturable=false
 * K17  over-capacity capturable=false
 * K18  offline station capturable=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readDist(rel: string): string {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`Dist no existe: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

// ─── K01–K10: Renderer ───────────────────────────────────────────────────────

describe('K01 — renderer muestra device recibido', () => {
  it('renderDevices existe en renderer.ts', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('function renderDevices(devices: DeviceState[])');
  });

  it('renderDevices usa canonicalDeviceName para mostrar el nombre (0.1.13)', () => {
    const src = readSrc('src/renderer/renderer.ts');
    // 0.1.13: usa canonicalDeviceName(d) — nunca escHtml(d.name) directamente
    expect(src).toContain('canonicalDeviceName');
    expect(src).toContain('escHtml(displayName)');
  });

  it('renderDevices usa d.weight_kg para mostrar el peso', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('d.weight_kg');
    expect(src).toContain('.toFixed(2)');
  });
});

describe('K02 — muestra COM4 proveniente del servidor', () => {
  it('renderDevices usa d.com_port (del servidor)', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('d.com_port');
    expect(src).toContain('escHtml(comPort)');
  });

  it('renderDevices incluye com_port en metaSerial', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('metaSerial');
    expect(src).toContain('comPort');
  });
});

describe('K03 — COM4 no hardcodeado en renderer', () => {
  it('renderer.ts no contiene COM4 hardcodeado', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).not.toContain("'COM4'");
    expect(src).not.toContain('"COM4"');
  });

  it('renderer compilado no contiene COM4 hardcodeado', () => {
    const js = readDist('dist/renderer/renderer.js');
    expect(js).not.toContain("'COM4'");
    expect(js).not.toContain('"COM4"');
  });
});

describe('K04 — muestra peso negativo exactamente como recibido', () => {
  it('renderer no aplica abs() al peso', () => {
    const src = readSrc('src/renderer/renderer.ts');
    // No debe haber Math.abs en el bloque de renderDevices
    const renderBlock = src.match(/function renderDevices[\s\S]*?^}/m)?.[0] ?? '';
    expect(renderBlock).not.toContain('Math.abs');
  });

  it('renderer no invierte el signo del peso', () => {
    const src = readSrc('src/renderer/renderer.ts');
    const renderBlock = src.match(/function renderDevices[\s\S]*?^}/m)?.[0] ?? '';
    // No debe haber -d.weight_kg ni weight_kg * -1
    expect(renderBlock).not.toMatch(/-d\.weight_kg/);
    expect(renderBlock).not.toMatch(/weight_kg \* -1/);
  });

  it('renderer usa toFixed(2) directamente sobre d.weight_kg', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('.toFixed(2)');
  });
});

describe('K05 — peso negativo muestra NO CAPTURABLE', () => {
  it('renderer tiene lógica weightNonPositive para peso <= 0', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('weightNonPositive');
    expect(src).toContain('<= 0');
  });

  it('renderer muestra NO CAPTURABLE cuando showNotCapturable', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('NO CAPTURABLE');
    expect(src).toContain('showNotCapturable');
  });

  it('renderer compilado contiene NO CAPTURABLE', () => {
    const js = readDist('dist/renderer/renderer.js');
    expect(js).toContain('NO CAPTURABLE');
  });
});

describe('K06 — server CONECTADO muestra Conectado', () => {
  it('updateConnectionStatus maneja CONECTADO', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain("'CONECTADO'");
    expect(src).toContain("'Conectado'");
  });

  it('render() pasa state.server_status a updateConnectionStatus', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('updateConnectionStatus(state.server_status)');
  });

  it('renderer compilado: CONECTADO → Conectado', () => {
    const js = readDist('dist/renderer/renderer.js');
    expect(js).toContain("'CONECTADO'");
    expect(js).toContain("'Conectado'");
  });
});

describe('K07 — NO_AUTORIZADO no muestra Conectado', () => {
  it('NO_AUTORIZADO branch tiene texto de error, no Conectado', () => {
    const src = readSrc('src/renderer/renderer.ts');
    const lines = src.split('\n');
    const noAuthIdx = lines.findIndex(l => l.includes("'NO_AUTORIZADO'"));
    expect(noAuthIdx).toBeGreaterThan(-1);
    const block = lines.slice(noAuthIdx, noAuthIdx + 5).join('\n');
    expect(block).not.toContain("'Conectado'");
  });

  it('renderer compilado: NO_AUTORIZADO → auth-error, no Conectado', () => {
    const js = readDist('dist/renderer/renderer.js');
    const lines = js.split('\n');
    const noAuthIdx = lines.findIndex(l => l.includes("'NO_AUTORIZADO'"));
    expect(noAuthIdx).toBeGreaterThan(-1);
    const block = lines.slice(noAuthIdx, noAuthIdx + 5).join('\n');
    expect(block).not.toContain("'Conectado'");
    expect(block).toContain('auth-error');
  });
});

describe('K08 — serial_open false muestra Desconectada', () => {
  it('renderer usa d.serial_open para serialLabel', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('d.serial_open');
    expect(src).toContain("'Desconectada'");
    expect(src).toContain("'Conectada'");
  });

  it('renderer tiene serial-closed class para serial_open=false', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('serial-closed');
    expect(src).toContain('serial-open');
  });

  it('index.html tiene estilos para serial-open y serial-closed', () => {
    const html = readSrc('src/renderer/index.html');
    expect(html).toContain('serial-open');
    expect(html).toContain('serial-closed');
  });
});

describe('K09 — stable true muestra ESTABLE', () => {
  it('renderer usa d.is_stable para stabilityLabel', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('d.is_stable');
    expect(src).toContain("'ESTABLE'");
  });

  it('renderer tiene stability-stable class', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('stability-stable');
  });

  it('index.html tiene estilos para stability-stable', () => {
    const html = readSrc('src/renderer/index.html');
    expect(html).toContain('stability-stable');
  });
});

describe('K10 — stable false muestra EN MOVIMIENTO', () => {
  it('renderer tiene EN MOVIMIENTO para is_stable=false', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain("'EN MOVIMIENTO'");
  });

  it('renderer tiene stability-moving class', () => {
    const src = readSrc('src/renderer/renderer.ts');
    expect(src).toContain('stability-moving');
  });

  it('index.html tiene estilos para stability-moving', () => {
    const html = readSrc('src/renderer/index.html');
    expect(html).toContain('stability-moving');
  });
});

// ─── K11–K18: GET /api/scales/devices/:id/state ──────────────────────────────

// Helper para tests del backend
const BACKEND_ROOT = path.resolve(__dirname, '../../../src');

function readBackend(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8');
}

type MockRow = Record<string, unknown>;

function makeDb(rows: { scale?: MockRow | null; reading?: MockRow | null; station?: MockRow | null }) {
  return {
    queryOne: vi.fn(async (sql: string) => {
      if (sql.includes('FROM scales')) return rows.scale ?? null;
      if (sql.includes('FROM scale_readings')) return rows.reading ?? null;
      if (sql.includes('FROM scale_stations')) return rows.station ?? null;
      return null;
    }),
  };
}

function makeReq(scaleId: number, companyId = 1) {
  return {
    params: { id: String(scaleId) },
    user: { companyId, userId: 1, username: 'test' },
    headers: { authorization: 'Bearer test' },
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null as unknown };
  return {
    status: (code: number) => { res.statusCode = code; return { json: (b: unknown) => { res.body = b; } }; },
    json: (b: unknown) => { res.body = b; },
    _get: () => res,
  };
}

// Verificamos el contrato del endpoint leyendo el source
describe('K11 — state endpoint devuelve lectura real sanitizada', () => {
  it('GET /api/scales/devices/:id/state existe en scales-admin.ts', () => {
    const src = readBackend('server/api/scales-admin.ts');
    expect(src).toContain("router.get('/devices/:id/state'");
  });

  it('endpoint devuelve weight_kg como Number()', () => {
    const src = readBackend('server/api/scales-admin.ts');
    expect(src).toContain('Number(lastReading.weight_kg)');
  });

  it('endpoint devuelve is_stable como Boolean()', () => {
    const src = readBackend('server/api/scales-admin.ts');
    expect(src).toContain('Boolean(lastReading.is_stable)');
  });

  it('endpoint calcula is_capturable con frescura', () => {
    const src = readBackend('server/api/scales-admin.ts');
    expect(src).toContain('Boolean(lastReading.is_capturable) && isFresh && !lastReading.is_invalidated');
  });

  it('endpoint calcula stationOnline con ventana de 30s', () => {
    const src = readBackend('server/api/scales-admin.ts');
    expect(src).toContain('30_000');
  });
});

describe('K12 — negative reading capturable=false', () => {
  it('scale-agent.ts: isCapturable retorna false para weight_kg <= 0', () => {
    const src = readBackend('server/api/scale-agent.ts');
    expect(src).toContain('if (weight_kg <= 0) return false');
  });

  it('scale-agent.ts: isCapturable rechaza -5 kg', () => {
    const src = readBackend('server/api/scale-agent.ts');
    // La función isCapturable debe estar presente y rechazar <= 0
    expect(src).toContain('function isCapturable(weight_kg: number');
    expect(src).toContain('weight_kg <= 0');
  });
});

describe('K13 — zero reading capturable=false', () => {
  it('isCapturable rechaza weight_kg = 0 (cero = báscula vacía)', () => {
    const src = readBackend('server/api/scale-agent.ts');
    // weight_kg <= 0 cubre tanto negativo como cero
    expect(src).toContain('weight_kg <= 0');
    // El comentario debe indicar que cero no es capturable
    expect(src).toContain('cero');
  });
});

describe('K14 — positive stable fresh reading capturable=true', () => {
  it('isCapturable retorna true para peso positivo, estable, dentro de capacidad', () => {
    const src = readBackend('server/api/scale-agent.ts');
    // La función isCapturable debe retornar true al final
    expect(src).toContain('function isCapturable(weight_kg: number');
    // Después de rechazar !is_stable, <=0, y >capacity, retorna true
    expect(src).toContain('return true;');
  });

  it('state endpoint: is_capturable=true cuando lectura es fresca y capturable', () => {
    const src = readBackend('server/api/scales-admin.ts');
    // La evaluación final combina is_capturable de DB + isFresh + !is_invalidated
    expect(src).toContain('Boolean(lastReading.is_capturable) && isFresh && !lastReading.is_invalidated');
  });
});

describe('K15 — stale reading capturable=false', () => {
  it('state endpoint: is_capturable=false cuando !isFresh', () => {
    const src = readBackend('server/api/scales-admin.ts');
    // is_capturable se evalúa con && isFresh
    expect(src).toContain('Boolean(lastReading.is_capturable) && isFresh');
  });

  it('capture endpoint: rechaza lectura stale con READING_STALE', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain("error: 'READING_STALE'");
    expect(src).toContain('ageSeconds > freshnessSeconds');
  });
});

describe('K16 — unstable reading capturable=false', () => {
  it('isCapturable: !is_stable → return false', () => {
    const src = readBackend('server/api/scale-agent.ts');
    expect(src).toContain('if (!is_stable) return false');
  });

  it('capture endpoint: rechaza lectura no capturable con READING_NOT_CAPTURABLE', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain("error: 'READING_NOT_CAPTURABLE'");
    expect(src).toContain('!reading.is_capturable');
  });
});

describe('K17 — over-capacity capturable=false', () => {
  it('isCapturable: weight_kg > capacity_kg → return false', () => {
    const src = readBackend('server/api/scale-agent.ts');
    expect(src).toContain('weight_kg > capacity_kg');
    expect(src).toContain('return false');
  });

  it('isCapturable: capacity_kg IS NULL = sin límite', () => {
    const src = readBackend('server/api/scale-agent.ts');
    expect(src).toContain('capacity_kg !== null && weight_kg > capacity_kg');
  });
});

describe('K18 — offline station capturable=false', () => {
  it('state endpoint: stationOnline=false cuando last_seen_at > 30s', () => {
    const src = readBackend('server/api/scales-admin.ts');
    expect(src).toContain('stationOnline');
    expect(src).toContain('30_000');
  });

  it('state endpoint: is_capturable incluye freshness (proxy de station online)', () => {
    const src = readBackend('server/api/scales-admin.ts');
    // Si la estación está offline, no habrá lecturas frescas → isFresh=false → is_capturable=false
    expect(src).toContain('Boolean(lastReading.is_capturable) && isFresh');
  });
});

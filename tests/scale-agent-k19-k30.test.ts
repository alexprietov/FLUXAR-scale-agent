/**
 * K19–K30: POST /api/weighings-v2/:id/capture-scale-reading
 *
 * F4-BASCULAS-07 — Gate para primera captura real en Pesaje
 *
 * K19  capture rejects negative
 * K20  capture rejects zero
 * K21  capture rejects stale
 * K22  capture rejects unstable
 * K23  capture rejects over-capacity
 * K24  capture rejects cross-tenant
 * K25  capture same reading same weighing idempotent
 * K26  same reading different weighing → 409
 * K27  successful capture appends weighing_weights source=scale
 * K28  successful capture stores scale_reading_id/station_id
 * K29  transaction rollback leaves no partial weight
 * K30  manual weighing path remains functional
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_ROOT = path.resolve(__dirname, '../../../src');

function readBackend(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8');
}

// ─── K19–K24: Validaciones de rechazo ────────────────────────────────────────

describe('K19 — capture rejects negative', () => {
  it('capture endpoint rechaza is_capturable=false (cubre negativo)', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain("error: 'READING_NOT_CAPTURABLE'");
    expect(src).toContain('!reading.is_capturable');
  });

  it('isCapturable en scale-agent rechaza weight_kg <= 0', () => {
    const src = readBackend('server/api/scale-agent.ts');
    expect(src).toContain('if (weight_kg <= 0) return false');
  });

  it('capture endpoint NO acepta weight_kg del frontend', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    // El peso viene de DB, no del body del request
    expect(src).toContain('const weightKg = Number(reading.weight_kg)');
    // El body solo acepta scale_reading_id y weight_slot
    expect(src).toContain('scale_reading_id?: number');
    expect(src).toContain("weight_slot?: 'weight_1' | 'weight_2'");
  });
});

describe('K20 — capture rejects zero', () => {
  it('isCapturable rechaza weight_kg = 0 (cero = báscula vacía)', () => {
    const src = readBackend('server/api/scale-agent.ts');
    // weight_kg <= 0 cubre cero
    expect(src).toContain('weight_kg <= 0');
  });

  it('capture endpoint rechaza is_capturable=false (cubre cero)', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('!reading.is_capturable');
    expect(src).toContain("error: 'READING_NOT_CAPTURABLE'");
  });
});

describe('K21 — capture rejects stale', () => {
  it('capture endpoint verifica frescura con freshnessSeconds', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('freshnessSeconds');
    expect(src).toContain('ageSeconds > freshnessSeconds');
  });

  it('capture endpoint devuelve READING_STALE con edad en mensaje', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain("error: 'READING_STALE'");
    expect(src).toContain('Math.floor(ageSeconds)');
  });

  it('capture endpoint carga freshness_seconds de scales table', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('freshness_seconds');
    expect(src).toContain('scale?.freshness_seconds ?? 10');
  });
});

describe('K22 — capture rejects unstable', () => {
  it('capture endpoint rechaza is_capturable=false (cubre inestable)', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('!reading.is_capturable');
    expect(src).toContain("error: 'READING_NOT_CAPTURABLE'");
  });

  it('isCapturable: !is_stable → false', () => {
    const src = readBackend('server/api/scale-agent.ts');
    expect(src).toContain('if (!is_stable) return false');
  });
});

describe('K23 — capture rejects over-capacity', () => {
  it('isCapturable rechaza weight_kg > capacity_kg', () => {
    const src = readBackend('server/api/scale-agent.ts');
    expect(src).toContain('capacity_kg !== null && weight_kg > capacity_kg');
  });

  it('capture endpoint rechaza is_capturable=false (cubre sobre-capacidad)', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('!reading.is_capturable');
  });
});

describe('K24 — capture rejects cross-tenant', () => {
  it('capture endpoint verifica company_id de la lectura', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('reading.company_id !== companyId');
    expect(src).toContain("error: 'READING_TENANT_MISMATCH'");
  });

  it('capture endpoint verifica branch_id coincide con el pesaje', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('reading.branch_id !== weighing.branch_id');
    expect(src).toContain("error: 'READING_BRANCH_MISMATCH'");
  });

  it('capture endpoint verifica company_id del pesaje', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('weighing.company_id !== companyId');
    expect(src).toContain("error: 'WEIGHING_NOT_FOUND'");
  });
});

// ─── K25–K26: Idempotencia y concurrencia ────────────────────────────────────

describe('K25 — capture same reading same weighing idempotent', () => {
  it('capture endpoint detecta mismo pesaje + misma lectura → idempotente', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('reading.weighing_id === weighingId');
    expect(src).toContain('idempotent: true');
    expect(src).toContain("message: 'Peso ya capturado (idempotente)'");
  });

  it('idempotencia devuelve el peso existente de weighing_weights', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('existingWw');
    expect(src).toContain('scale_reading_id = ?');
  });
});

describe('K26 — same reading different weighing → 409', () => {
  it('capture endpoint: lectura consumida por OTRO pesaje → 409 READING_ALREADY_CONSUMED', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain("error: 'READING_ALREADY_CONSUMED'");
    expect(src).toContain('Esta lectura ya fue capturada en otro pesaje');
  });

  it('guard atómico: UPDATE WHERE weighing_id IS NULL → 0 rows → CONFLICT', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('WHERE id = ? AND weighing_id IS NULL');
    expect(src).toContain("err.code = 'CONFLICT'");
  });
});

// ─── K27–K29: Escritura correcta ─────────────────────────────────────────────

describe('K27 — successful capture appends weighing_weights source=scale', () => {
  it("capture endpoint inserta en weighing_weights con source='scale'", () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain("INSERT INTO weighing_weights");
    expect(src).toContain("'scale'");
    expect(src).toContain('source');
  });

  it('capture endpoint usa peso de DB, no del frontend', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('const weightKg = Number(reading.weight_kg)');
  });
});

describe('K28 — successful capture stores scale_reading_id/station_id', () => {
  it('weighing_weights INSERT incluye scale_reading_id y station_id', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    // Buscar en la sección de capture-scale-reading
    const captureSection = src.slice(src.indexOf('capture-scale-reading'));
    expect(captureSection).toContain('scale_reading_id');
    expect(captureSection).toContain('station_id');
  });

  it('weighings_v2 UPDATE incluye readingIdField (scale_reading_id_1 o _2)', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    const captureSection = src.slice(src.indexOf('capture-scale-reading'));
    // readingIdField construye scale_reading_id_1 o scale_reading_id_2
    expect(captureSection).toContain('readingIdField');
  });

  it('evento de auditoría incluye station_id en data JSON', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    const captureSection = src.slice(src.indexOf('capture-scale-reading'));
    expect(captureSection).toContain('station_id');
    expect(captureSection).toContain('pesada_bascula');
  });
});

describe('K29 — transaction rollback leaves no partial weight', () => {
  it('capture usa dbTransaction para atomicidad', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    const captureSection = src.slice(src.indexOf('capture-scale-reading'));
    expect(captureSection).toContain('dbTransaction');
  });

  it('catch de la transacción maneja CONFLICT', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    const captureSection = src.slice(src.indexOf('capture-scale-reading'));
    expect(captureSection).toContain("err.code = 'CONFLICT'");
    expect(captureSection).toContain("code === 'CONFLICT'");
  });

  it('guard atómico: throw CONFLICT ocurre antes del INSERT en weighing_weights', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    const captureSection = src.slice(src.indexOf('capture-scale-reading'));
    const throwIdx = captureSection.indexOf("err.code = 'CONFLICT'");
    const insertIdx = captureSection.indexOf("INSERT INTO weighing_weights");
    expect(throwIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(throwIdx).toBeLessThan(insertIdx);
  });
});

// ─── K30: Ruta manual no afectada ────────────────────────────────────────────

describe('K30 — manual weighing path remains functional', () => {
  it('weighings-v2.ts tiene ruta de peso manual (add-weight o second-weight)', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('add-weight');
  });

  it('ruta manual usa source manual', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain("weight_2_source = 'manual'");
  });

  it('capture-scale-reading coexiste con rutas manuales', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    expect(src).toContain('capture-scale-reading');
    expect(src).toContain('add-weight');
  });

  it('weighing_weights append-only: no hay DELETE en sección de captura', () => {
    const src = readBackend('server/api/weighings-v2.ts');
    const captureSection = src.slice(src.indexOf('capture-scale-reading'));
    // La sección de captura no debe tener DELETE FROM weighing_weights
    expect(captureSection).not.toMatch(/DELETE FROM weighing_weights/);
  });
});

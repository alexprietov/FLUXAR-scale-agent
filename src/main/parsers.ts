/**
 * Parsers de protocolo serial
 *
 * ScaleParser — interfaz común
 * GenericTextParser — texto numérico simple (ej. "12480.5\r\n")
 * BasysParser — protocolo BASYS
 *
 * BASYS_FORMAT_NEEDS_REAL_SAMPLE=true
 * El formato exacto de BASYS no está disponible en el repositorio.
 * BasysParser está preparado pero requiere muestra real para validar.
 * GenericTextParser permite continuar pruebas con salida numérica compatible.
 */

import type { ParsedSample } from '../shared/types.js';

// ─── Interfaz ─────────────────────────────────────────────────────────────────

export interface ScaleParser {
  readonly protocol: string;
  parse(raw: string): ParsedSample | null;
}

// ─── GenericTextParser ────────────────────────────────────────────────────────
// Espera líneas de texto con un número (kg o cualquier unidad).
// Formato: "12480.5\r\n" o "12480.5 kg\r\n" o "  12480.5  \r\n"
// Estabilidad: si la línea contiene 'ST' o 'S' antes del número → stable_hint=true
// Si contiene 'US' o 'U' → stable_hint=false

export class GenericTextParser implements ScaleParser {
  readonly protocol = 'GENERIC';

  parse(raw: string): ParsedSample | null {
    const line = raw.trim();
    if (!line) return null;

    // Detectar hint de estabilidad
    const upperLine = line.toUpperCase();
    let stable_hint: boolean | null = null;
    if (upperLine.includes('ST,') || upperLine.startsWith('ST') || upperLine.includes(' ST ')) {
      stable_hint = true;
    } else if (upperLine.includes('US,') || upperLine.startsWith('US') || upperLine.includes(' US ')) {
      stable_hint = false;
    }

    // Extraer número
    const match = line.match(/[-+]?\d+(?:[.,]\d+)?/);
    if (!match) return null;

    const numStr = match[0].replace(',', '.');
    const weight_kg = parseFloat(numStr);
    if (isNaN(weight_kg)) return null;

    // Detectar unidad
    const unitMatch = line.match(/\b(kg|lb|t|g)\b/i);
    const unit = unitMatch ? unitMatch[1].toLowerCase() : 'kg';

    return {
      weight_kg,
      unit,
      stable_hint,
      raw_payload: line.slice(0, 4096),
      parsed_at: Date.now(),
    };
  }
}

// ─── BasysParser ──────────────────────────────────────────────────────────────
// BASYS_FORMAT_NEEDS_REAL_SAMPLE=true
//
// Formato conocido parcialmente de pruebas físicas anteriores:
// Trama típica BASYS: STX + datos + ETX o líneas con prefijo de estado.
// Sin muestra real confirmada, se implementa con best-effort y flag explícito.
//
// Cuando BASYS_FORMAT_NEEDS_REAL_SAMPLE=true:
//   - Se intenta parsear con heurística conocida
//   - Si falla, se delega a GenericTextParser como fallback
//   - Se loguea que el formato necesita confirmación

export const BASYS_FORMAT_NEEDS_REAL_SAMPLE = true;

export class BasysParser implements ScaleParser {
  readonly protocol = 'BASYS';
  private fallback = new GenericTextParser();

  parse(raw: string): ParsedSample | null {
    const line = raw.trim();
    if (!line) return null;

    // Intentar formato BASYS conocido:
    // Ejemplo observado en pruebas: "ST,GS,  12480.5 kg" o "US,GS,  12480.5 kg"
    // STX/ETX stripped por SerialPort parser antes de llegar aquí
    const basysMatch = line.match(/^(ST|US),\s*(?:GS|NT),\s*([-+]?\d+(?:[.,]\d+)?)\s*(kg|lb|t|g)?/i);

    if (basysMatch) {
      const stable_hint = basysMatch[1].toUpperCase() === 'ST';
      const numStr = basysMatch[2].replace(',', '.');
      const weight_kg = parseFloat(numStr);
      if (isNaN(weight_kg)) return null;
      const unit = basysMatch[3]?.toLowerCase() ?? 'kg';

      return {
        weight_kg,
        unit,
        stable_hint,
        raw_payload: line.slice(0, 4096),
        parsed_at: Date.now(),
      };
    }

    // Fallback a GenericTextParser si BASYS no matchea
    // (útil mientras se confirma formato real)
    if (BASYS_FORMAT_NEEDS_REAL_SAMPLE) {
      const result = this.fallback.parse(raw);
      if (result) {
        return { ...result, raw_payload: `[BASYS_FALLBACK] ${result.raw_payload}`.slice(0, 4096) };
      }
    }

    return null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createParser(protocol: string): ScaleParser {
  switch (protocol.toUpperCase()) {
    case 'BASYS':
      return new BasysParser();
    case 'GENERIC':
    default:
      return new GenericTextParser();
  }
}

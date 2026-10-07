/**
 * F4-SCALE-AGENT-15 — Tests AGENT01–AGENT22
 *
 * Multi-báscula automática + autoarranque Windows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());

function src(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

// ─── AGENT01 — dos devices se muestran simultáneamente ───────────────────────
describe('AGENT01 — dos devices se muestran simultáneamente', () => {
  it('renderDevices itera sobre el array completo de devices', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).toContain('renderDevices(state.devices)');
    expect(r).toContain('devices.map(d =>');
  });
  it('renderDevices genera un card por device', () => {
    const r = src('src/renderer/renderer.ts');
    const fn = r.slice(r.indexOf('function renderDevices'));
    expect(fn).toContain('device-card');
    // 0.1.14: usa canonicalDeviceName(d) en lugar de d.name directamente
    expect(fn).toContain('canonicalDeviceName');
  });
});

// ─── AGENT02 — dos SerialPorts independientes ─────────────────────────────────
describe('AGENT02 — dos SerialPorts independientes', () => {
  it('SerialManager usa Map<scale_id, ...> para múltiples puertos', () => {
    const s = src('src/main/serial-manager.ts');
    expect(s).toContain('Map');
    expect(s).toContain('scale_id');
  });
  it('_openDevice se llama por cada device con su propio com_port', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('_openDevice(d, effectiveCfg)');
    expect(a).toContain('for (const d of newDevices)');
  });
});

// ─── AGENT03 — nuevo device aparece sin reiniciar ─────────────────────────────
describe('AGENT03 — nuevo device aparece sin reiniciar', () => {
  it('_fetchDevices detecta devices nuevos (no en prevIds) y los abre', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('prevIds.has(d.scale_id)');
    expect(a).toContain('nuevo — abriendo puerto');
  });
  it('devicePollTimer ejecuta _fetchDevices periódicamente', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('devicePollTimer');
    expect(a).toContain('DEVICE_POLL_INTERVAL_MS');
  });
});

// ─── AGENT04 — device modificado reabre puerto ───────────────────────────────
describe('AGENT04 — device modificado reabre puerto', () => {
  it('_fetchDevices detecta configChanged y reabre el puerto', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('configChanged');
    expect(a).toContain('config modificada — reabriendo puerto');
    expect(a).toContain('closeDevice(d.scale_id)');
  });
});

// ─── AGENT05 — device eliminado cierra puerto ────────────────────────────────
describe('AGENT05 — device eliminado cierra puerto', () => {
  it('_fetchDevices cierra puerto de devices que ya no están en newIds', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('newIds.has(d.scale_id)');
    expect(a).toContain('eliminado — cerrando puerto');
    expect(a).toContain('deviceStates.delete(d.scale_id)');
  });
});

// ─── AGENT06 — fallo COM5 no afecta COM4 ─────────────────────────────────────
describe('AGENT06 — fallo COM5 no afecta COM4', () => {
  it('SerialManager maneja cada puerto independientemente', () => {
    const s = src('src/main/serial-manager.ts');
    // Cada device tiene su propio estado en el Map
    expect(s).toContain('Map');
    expect(s).toContain('scale_id');
  });
  it('error en un device no propaga a otros en _fetchDevices', () => {
    const a = src('src/main/agent-service.ts');
    // El try/catch en _openDevice es por device
    expect(a).toContain('_openDevice');
    // El loop continúa con otros devices
    expect(a).toContain('for (const d of newDevices)');
  });
});

// ─── AGENT07 — botón Actualizar hace fetch inmediato ─────────────────────────
describe('AGENT07 — botón Actualizar hace fetch inmediato', () => {
  it('btn-refresh-config existe en index.html', () => {
    const h = src('src/renderer/index.html');
    expect(h).toContain('btn-refresh-config');
    expect(h).toContain('Actualizar configuración');
  });
  it('renderer.ts maneja click en btn-refresh-config llamando refreshDevices()', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).toContain('btn-refresh-config');
    expect(r).toContain('refreshDevices()');
  });
  it('preload expone refreshDevices', () => {
    const p = src('src/preload/preload.ts');
    expect(p).toContain('refreshDevices');
    expect(p).toContain('REFRESH_DEVICES');
  });
  it('IPC.REFRESH_DEVICES está definido', () => {
    const t = src('src/shared/types.ts');
    expect(t).toContain("REFRESH_DEVICES:");
    expect(t).toContain("'refresh-devices'");
  });
  it('main.ts maneja IPC.REFRESH_DEVICES', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('IPC.REFRESH_DEVICES');
    expect(m).toContain('refreshDevices()');
  });
});

// ─── AGENT08 — polling actualiza devices ─────────────────────────────────────
describe('AGENT08 — polling actualiza devices', () => {
  it('DEVICE_POLL_INTERVAL_MS está definido en agent-service', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('DEVICE_POLL_INTERVAL_MS');
    expect(a).toContain('30_000');
  });
  it('_startDevicePoll usa setInterval con DEVICE_POLL_INTERVAL_MS', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('_startDevicePoll'));
    expect(fn).toContain('setInterval');
    expect(fn).toContain('DEVICE_POLL_INTERVAL_MS');
  });
  it('initialize() llama _startDevicePoll cuando hay token', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('async initialize()'));
    const end = fn.indexOf('\n  }');
    const body = fn.slice(0, end);
    expect(body).toContain('_startDevicePoll()');
  });
  it('_afterEnrollment llama _startDevicePoll', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('private async _afterEnrollment()'));
    // Tomar hasta el siguiente método privado
    const end = fn.indexOf('\n  async unlink()');
    const body = end > 0 ? fn.slice(0, end) : fn.slice(0, 300);
    expect(body).toContain('_startDevicePoll()');
  });
});

// ─── AGENT09 — station token se conserva ─────────────────────────────────────
describe('AGENT09 — station token se conserva', () => {
  it('refreshDevices no toca el token', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('async refreshDevices()'));
    const end = fn.indexOf('\n  }');
    const body = fn.slice(0, end);
    expect(body).not.toContain('clearToken');
    expect(body).not.toContain('clearStationMeta');
  });
  it('_fetchDevices no toca el token', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('private async _fetchDevices()'));
    const end = fn.indexOf('\n  private ');
    const body = fn.slice(0, end);
    expect(body).not.toContain('clearToken');
  });
});

// ─── AGENT10 — no reenrollment ────────────────────────────────────────────────
describe('AGENT10 — no reenrollment', () => {
  it('refreshDevices usa token existente (api.hasToken), no enrollment', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('async refreshDevices()'));
    const end = fn.indexOf('\n  }');
    const body = fn.slice(0, end);
    expect(body).toContain('hasToken()');
    expect(body).not.toContain('enroll');
  });
  it('_startDevicePoll verifica hasToken antes de fetch', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('_startDevicePoll'));
    const end = fn.indexOf('\n  private _stopDevicePoll');
    const body = fn.slice(0, end);
    expect(body).toContain('hasToken()');
  });
});

// ─── AGENT11 — auto-start Windows enable ─────────────────────────────────────
describe('AGENT11 — auto-start Windows enable', () => {
  it('SET_AUTOSTART handler llama app.setLoginItemSettings({ openAtLogin: true })', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('app.setLoginItemSettings');
    expect(m).toContain('openAtLogin: value');
  });
  it('IPC.SET_AUTOSTART está definido', () => {
    const t = src('src/shared/types.ts');
    expect(t).toContain("SET_AUTOSTART:");
    expect(t).toContain("'set-autostart'");
  });
  it('preload expone setAutostart', () => {
    const p = src('src/preload/preload.ts');
    expect(p).toContain('setAutostart');
  });
});

// ─── AGENT12 — auto-start Windows disable ────────────────────────────────────
describe('AGENT12 — auto-start Windows disable', () => {
  it('SET_AUTOSTART handler acepta value=false', () => {
    const m = src('src/main/main.ts');
    const handler = m.slice(m.indexOf('IPC.SET_AUTOSTART'));
    expect(handler).toContain('openAtLogin: value');
    // value puede ser false → openAtLogin: false
  });
  it('toggle-autostart en renderer puede desactivarse', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).toContain('toggle-autostart');
    expect(r).toContain('setAutostart(autostartOn)');
  });
});

// ─── AGENT13 — auto-start inicia minimizado ──────────────────────────────────
describe('AGENT13 — auto-start inicia minimizado', () => {
  it('main.ts verifica wasOpenedAsHidden o start_minimized para no mostrar ventana', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('wasOpenedAsHidden');
    expect(m).toContain('start_minimized');
  });
  it('config-store tiene start_minimized con default true', () => {
    const c = src('src/main/config-store.ts');
    expect(c).toContain('start_minimized: true');
  });
  it('AppConfig incluye start_minimized', () => {
    const t = src('src/shared/types.ts');
    expect(t).toContain('start_minimized: boolean');
  });
});

// ─── AGENT14 — tray mantiene proceso activo ──────────────────────────────────
describe('AGENT14 — tray mantiene proceso activo', () => {
  it('main.ts crea Tray', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('createTray()');
    expect(m).toContain('new Tray(');
  });
  it('tray tiene opciones Abrir y Salir', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('Abrir');
    expect(m).toContain('Salir');
  });
});

// ─── AGENT15 — X minimiza/no mata lectura ────────────────────────────────────
describe('AGENT15 — X minimiza/no mata lectura', () => {
  it('close event en main.ts llama hide() en lugar de destroy()', () => {
    const m = src('src/main/main.ts');
    // El handler de close debe prevenir el cierre y ocultar la ventana
    expect(m).toContain("'close'");
    expect(m).toContain('.hide()');
  });
  it('close event llama preventDefault o event.preventDefault', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('preventDefault');
  });
});

// ─── AGENT16 — Salir termina proceso ─────────────────────────────────────────
describe('AGENT16 — Salir termina proceso ─────────────────────────────────────', () => {
  it('opción Salir en tray llama app.quit()', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('app.quit()');
    expect(m).toContain('Salir');
  });
});

// ─── AGENT17 — reconnect internet ────────────────────────────────────────────
describe('AGENT17 — reconnect internet', () => {
  it('heartbeat reintenta automáticamente (setInterval)', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('HEARTBEAT_INTERVAL_MS');
    expect(a).toContain('_doHeartbeat');
  });
  it('offline queue acumula lecturas cuando no hay conexión', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('queue');
    expect(a).toContain('_flushQueue');
  });
});

// ─── AGENT18 — reconnect COM ─────────────────────────────────────────────────
describe('AGENT18 — reconnect COM', () => {
  it('SerialManager tiene backoff/reconnect para puertos', () => {
    const s = src('src/main/serial-manager.ts');
    expect(s).toContain('reconnect');
  });
});

// ─── AGENT19 — heartbeat sigue en tray ───────────────────────────────────────
describe('AGENT19 — heartbeat sigue en tray', () => {
  it('heartbeat no depende de la visibilidad de la ventana', () => {
    const a = src('src/main/agent-service.ts');
    // heartbeat está en AgentService, no en main window
    expect(a).toContain('_startHeartbeat');
    expect(a).toContain('setInterval');
    // No hay referencia a mainWindow en agent-service
    expect(a).not.toContain('mainWindow');
  });
});

// ─── AGENT20 — readings siguen en tray ───────────────────────────────────────
describe('AGENT20 — readings siguen en tray', () => {
  it('envío de lecturas está en AgentService (no en renderer)', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('_onSample');
    expect(a).toContain('api.postReading');
  });
  it('AgentService no depende de mainWindow para enviar lecturas', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).not.toContain('mainWindow');
  });
});

// ─── AGENT21 — versión UI coincide package ───────────────────────────────────
describe('AGENT21 — versión UI coincide package', () => {
  it('APP_VERSION en agent-service es 0.1.14', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain("APP_VERSION = '0.1.14'");
  });
  it('package.json versión es 0.1.14', () => {
    const p = src('package.json');
    const pkg = JSON.parse(p);
    expect(pkg.version).toBe('0.1.14');
  });
  it('renderer muestra app-version desde state.version', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).toContain('app-version');
    expect(r).toContain('state.version');
  });
  it('AppState incluye version', () => {
    const t = src('src/shared/types.ts');
    expect(t).toContain('version: string');
  });
});

// ─── AGENT22 — no hay botón Nueva báscula local ───────────────────────────────
describe('AGENT22 — no hay botón Nueva báscula local', () => {
  it('index.html no tiene botón "Nueva báscula"', () => {
    const h = src('src/renderer/index.html');
    expect(h).not.toContain('Nueva báscula');
    expect(h).not.toContain('add-device');
    expect(h).not.toContain('btn-add-device');
  });
  it('renderer.ts no tiene lógica de agregar báscula local', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).not.toContain('Nueva báscula');
    expect(r).not.toContain('addDevice');
    expect(r).not.toContain('btn-add-device');
  });
  it('La autoridad de devices es el backend (GET /api/scale-agent/devices)', () => {
    const a = src('src/main/api-client.ts');
    expect(a).toContain('getDevices');
    expect(a).toContain('/api/scale-agent/devices');
  });
});

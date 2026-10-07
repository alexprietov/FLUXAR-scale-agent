/**
 * F4-SCALE-AGENT-16 — Tests AGENT23–AGENT42
 *
 * Diff inteligente, guard de polling, error de fetch, autoarranque,
 * start_minimized, tray, versión única.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());

function src(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

// ─── AGENT23 — unchanged config does not reopen COM4 ─────────────────────────
describe('AGENT23 — unchanged config does not reopen COM4', () => {
  it('_fetchDevices detecta configChanged antes de cerrar/reabrir', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('configChanged');
    // Solo reabre si configChanged es true
    expect(a).toContain('if (configChanged && comPort)');
  });
  it('device existente sin cambio NO llama closeDevice ni _openDevice', () => {
    const a = src('src/main/agent-service.ts');
    // La lógica de configChanged debe ser false para config idéntica
    const fn = a.slice(a.indexOf('configChanged ='));
    expect(fn).toContain('comPort !== prevCom');
    expect(fn).toContain('newBaud  !== prevBaud');
  });
});

// ─── AGENT24 — adding Mediana does not reopen Camionera ──────────────────────
describe('AGENT24 — adding Mediana does not reopen Camionera', () => {
  it('solo los devices nuevos (no en prevIds) abren puerto', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('prevIds.has(d.scale_id)');
    // El bloque de nuevo device solo se ejecuta cuando !prevIds.has(d.scale_id)
    const fn = a.slice(a.indexOf('if (!prevIds.has(d.scale_id))'));
    expect(fn).toContain('nuevo — abriendo puerto');
  });
  it('devices existentes con misma config no se tocan', () => {
    const a = src('src/main/agent-service.ts');
    // El else solo reabre si configChanged
    expect(a).toContain('config modificada — reabriendo puerto');
  });
});

// ─── AGENT25 — modifying Mediana only reopens Mediana ────────────────────────
describe('AGENT25 — modifying Mediana only reopens Mediana', () => {
  it('closeDevice y _openDevice se llaman con el scale_id del device modificado', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('await this.serial.closeDevice(d.scale_id)');
    expect(a).toContain('await this._openDevice(d, effectiveCfg)');
  });
  it('el loop itera por device, no cierra todos', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('for (const d of newDevices)');
    // No hay closeAll() dentro del loop de reconciliación
    const loopStart = a.indexOf('for (const d of newDevices)');
    const loopEnd   = a.indexOf('this.devices = newDevices');
    const loopBody  = a.slice(loopStart, loopEnd);
    expect(loopBody).not.toContain('closeAll()');
  });
});

// ─── AGENT26 — deleting Mediana does not affect Camionera ────────────────────
describe('AGENT26 — deleting Mediana does not affect Camionera', () => {
  it('solo cierra devices que ya no están en newIds', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('newIds.has(d.scale_id)');
    expect(a).toContain('eliminado — cerrando puerto');
  });
  it('el loop de eliminados itera sobre this.devices (previos), no sobre newDevices', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('for (const d of this.devices)');
    const loopStart = a.indexOf('for (const d of this.devices)');
    const loopEnd   = a.indexOf('for (const d of newDevices)');
    const loopBody  = a.slice(loopStart, loopEnd);
    expect(loopBody).toContain('!newIds.has(d.scale_id)');
  });
});

// ─── AGENT27 — fetch devices HTTP error keeps current devices open ────────────
describe('AGENT27 — fetch devices HTTP error keeps current devices open', () => {
  it('error de getDevices hace return sin modificar this.devices', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('manteniendo configuración actual');
    expect(a).toContain('this.emit(\'fetch-devices-error\'');
    // El return temprano evita modificar this.devices
    const errBlock = a.slice(a.indexOf('manteniendo configuración actual'));
    expect(errBlock).toContain('return;');
  });
  it('error de fetch NO llama closeDevice ni closeAll', () => {
    const a = src('src/main/agent-service.ts');
    // El bloque de error de fetch hace return antes de cualquier closeDevice
    const fetchFn = a.slice(a.indexOf('private async _fetchDevices()'));
    const errIdx  = fetchFn.indexOf('manteniendo configuración actual');
    const errBlock = fetchFn.slice(errIdx, errIdx + 200);
    expect(errBlock).not.toContain('closeDevice');
    expect(errBlock).not.toContain('closeAll');
  });
});

// ─── AGENT28 — overlapping polls prevented ───────────────────────────────────
describe('AGENT28 — overlapping polls prevented', () => {
  it('deviceRefreshInFlight guard existe en agent-service', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('deviceRefreshInFlight');
  });
  it('_fetchDevices retorna early si deviceRefreshInFlight=true', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('if (this.deviceRefreshInFlight)');
    const fn = a.slice(a.indexOf('if (this.deviceRefreshInFlight)'));
    expect(fn).toContain('return;');
  });
  it('deviceRefreshInFlight se resetea en finally', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain('finally {');
    const fn = a.slice(a.indexOf('finally {'));
    expect(fn).toContain('this.deviceRefreshInFlight = false');
  });
});

// ─── AGENT29 — only one device poll timer ────────────────────────────────────
describe('AGENT29 — only one device poll timer', () => {
  it('_startDevicePoll llama _stopDevicePoll() antes de crear nuevo timer', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('private _startDevicePoll()'));
    const end = fn.indexOf('\n  private _stopDevicePoll()');
    const body = fn.slice(0, end);
    expect(body).toContain('this._stopDevicePoll()');
    expect(body).toContain('setInterval');
  });
  it('_stopDevicePoll limpia el timer y lo pone null', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('private _stopDevicePoll()'));
    const end = fn.indexOf('\n  /**');
    const body = fn.slice(0, end > 0 ? end : 200);
    expect(body).toContain('clearInterval');
    expect(body).toContain('this.devicePollTimer = null');
  });
});

// ─── AGENT30 — unlink stops polling ──────────────────────────────────────────
describe('AGENT30 — unlink stops polling', () => {
  it('unlink() llama _stopDevicePoll()', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('async unlink()'));
    const end = fn.indexOf('\n  // ─── Fetch');
    const body = fn.slice(0, end > 0 ? end : 300);
    expect(body).toContain('_stopDevicePoll()');
  });
});

// ─── AGENT31 — destroy stops polling ─────────────────────────────────────────
describe('AGENT31 — destroy stops polling', () => {
  it('destroy() llama _stopDevicePoll()', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('async destroy()'));
    const end = fn.indexOf('\n  // ─');
    const body = fn.slice(0, end > 0 ? end : 300);
    expect(body).toContain('_stopDevicePoll()');
  });
});

// ─── AGENT32 — manual refresh reconciles immediately ─────────────────────────
describe('AGENT32 — manual refresh reconciles immediately', () => {
  it('refreshDevices() llama _fetchDevices() directamente', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('async refreshDevices()'));
    const end = fn.indexOf('\n  private async _openDevice');
    const body = fn.slice(0, end > 0 ? end : 400);
    expect(body).toContain('_fetchDevices()');
  });
  it('IPC REFRESH_DEVICES llama agentService.refreshDevices()', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('IPC.REFRESH_DEVICES');
    expect(m).toContain('agentService.refreshDevices()');
  });
});

// ─── AGENT33 — manual refresh error preserves devices ────────────────────────
describe('AGENT33 — manual refresh error preserves devices', () => {
  it('refreshDevices retorna { ok, error? } en lugar de void', () => {
    const a = src('src/main/agent-service.ts');
    const fn = a.slice(a.indexOf('async refreshDevices()'));
    const end = fn.indexOf('\n  private async _openDevice');
    const body = fn.slice(0, end > 0 ? end : 400);
    expect(body).toContain('{ ok: true }');
    expect(body).toContain('{ ok: false');
  });
  it('renderer muestra "No se pudo actualizar" en error', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).toContain('No se pudo actualizar');
  });
  it('renderer muestra "Configuración actualizada" en éxito', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).toContain('Configuración actualizada');
  });
});

// ─── AGENT34 — autostart true calls setLoginItemSettings enabled ──────────────
describe('AGENT34 — autostart true calls setLoginItemSettings enabled', () => {
  it('SET_AUTOSTART handler llama app.setLoginItemSettings({ openAtLogin: value })', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('app.setLoginItemSettings');
    expect(m).toContain('openAtLogin: value');
  });
  it('al arrancar, sincroniza autostart con OS (WINDOWS_LOGIN_ITEM_SYNC_ON_START)', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('AUTOSTART_SYNC_ON_START');
    expect(m).toContain('autostartPref');
    // 0.1.14: incluye args: ['--hidden'] para wasOpenedAsHidden en Windows
    expect(m).toContain('openAtLogin: autostartPref');
    expect(m).toContain("args: ['--hidden']");
  });
});

// ─── AGENT35 — autostart false calls setLoginItemSettings disabled ────────────
describe('AGENT35 — autostart false calls setLoginItemSettings disabled', () => {
  it('SET_AUTOSTART con value=false desactiva el login item', () => {
    const m = src('src/main/main.ts');
    // El handler usa `value` directamente, que puede ser false
    const handler = m.slice(m.indexOf('IPC.SET_AUTOSTART'));
    expect(handler).toContain('openAtLogin: value');
  });
  it('al arrancar con autostart=false, sincroniza openAtLogin=false', () => {
    const m = src('src/main/main.ts');
    // autostartPref = cfg.autostart ?? true → si cfg.autostart=false, autostartPref=false
    expect(m).toContain('cfg.autostart ?? true');
    // 0.1.14: setLoginItemSettings incluye args: ['--hidden'] para Windows
    expect(m).toContain('openAtLogin: autostartPref');
    expect(m).toContain("args: ['--hidden']");
  });
});

// ─── AGENT36 — existing false preference preserved ───────────────────────────
describe('AGENT36 — existing false preference preserved', () => {
  it('config-store usa spread para preservar valores existentes', () => {
    const c = src('src/main/config-store.ts');
    // { ...DEFAULT_CONFIG, ...JSON.parse(raw) } → valores del archivo sobreescriben defaults
    expect(c).toContain('...DEFAULT_CONFIG');
    expect(c).toContain('JSON.parse(raw)');
  });
  it('autostart default es true en DEFAULT_CONFIG', () => {
    const c = src('src/main/config-store.ts');
    expect(c).toContain('autostart: true');
  });
  it('start_minimized default es true en DEFAULT_CONFIG', () => {
    const c = src('src/main/config-store.ts');
    expect(c).toContain('start_minimized: true');
  });
});

// ─── AGENT37 — login launch hidden ───────────────────────────────────────────
describe('AGENT37 — login launch hidden', () => {
  it('main.ts verifica wasOpenedAsHidden para ocultar ventana', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('wasOpenedAsHidden');
    expect(m).toContain('start_minimized');
  });
  it('solo oculta cuando wasAutoLaunched && startMinimized', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('wasAutoLaunched && startMinimized');
    expect(m).toContain('LAUNCH_HIDDEN');
  });
  it('lanzamiento manual muestra la ventana', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('LAUNCH_VISIBLE');
    expect(m).toContain('mainWindow!.show()');
  });
});

// ─── AGENT38 — manual launch visible ─────────────────────────────────────────
describe('AGENT38 — manual launch visible', () => {
  it('cuando wasOpenedAsHidden=false, la ventana se muestra', () => {
    const m = src('src/main/main.ts');
    // El else del if (wasAutoLaunched && startMinimized) llama show()
    expect(m).toContain('mainWindow!.show()');
    expect(m).toContain('LAUNCH_VISIBLE');
  });
  it('start_minimized=false también muestra la ventana', () => {
    const m = src('src/main/main.ts');
    // La condición es AND: ambas deben ser true para ocultar
    expect(m).toContain('wasAutoLaunched && startMinimized');
  });
});

// ─── AGENT39 — tray open restores window ─────────────────────────────────────
describe('AGENT39 — tray open restores window', () => {
  it('tray click llama show() y focus()', () => {
    const m = src('src/main/main.ts');
    const trayClick = m.slice(m.indexOf("tray.on('click'"));
    const end = trayClick.indexOf('\n  });');
    const body = trayClick.slice(0, end);
    expect(body).toContain('mainWindow.show()');
    expect(body).toContain('mainWindow.focus()');
  });
  it('menú tray tiene opción "Abrir"', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain("label: 'Abrir'");
  });
  it('opción Abrir llama show() y focus()', () => {
    const m = src('src/main/main.ts');
    const abrirIdx = m.indexOf("label: 'Abrir'");
    const abrirBlock = m.slice(abrirIdx, abrirIdx + 200);
    expect(abrirBlock).toContain('mainWindow.show()');
    expect(abrirBlock).toContain('mainWindow.focus()');
  });
});

// ─── AGENT40 — X keeps serial active ─────────────────────────────────────────
describe('AGENT40 — X keeps serial active', () => {
  it("close event llama preventDefault y hide()", () => {
    const m = src('src/main/main.ts');
    expect(m).toContain("'close'");
    expect(m).toContain('e.preventDefault()');
    expect(m).toContain('.hide()');
  });
  it('close event solo destruye cuando isQuitting=true', () => {
    const m = src('src/main/main.ts');
    const closeHandler = m.slice(m.indexOf("mainWindow.on('close'"));
    const end = closeHandler.indexOf('\n  });');
    const body = closeHandler.slice(0, end);
    expect(body).toContain('isQuitting');
  });
  it('window-all-closed no llama app.quit()', () => {
    const m = src('src/main/main.ts');
    const handler = m.slice(m.indexOf("app.on('window-all-closed'"));
    const end = handler.indexOf('\n});');
    const body = handler.slice(0, end);
    expect(body).not.toContain('app.quit()');
  });
});

// ─── AGENT41 — tray Exit destroys agent cleanly ──────────────────────────────
describe('AGENT41 — tray Exit destroys agent cleanly', () => {
  it('opción Salir llama app.quit()', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain('app.quit()');
    expect(m).toContain('Salir');
  });
  it('before-quit llama agentService.destroy() con timeout', () => {
    const m = src('src/main/main.ts');
    expect(m).toContain("app.on('before-quit'");
    const fn = m.slice(m.indexOf("app.on('before-quit'"));
    expect(fn).toContain('agentService?.destroy()');
    expect(fn).toContain('Promise.race');
    expect(fn).toContain('setTimeout');
  });
  it('before-quit no bloquea indefinidamente (timeout de 3s)', () => {
    const m = src('src/main/main.ts');
    const fn = m.slice(m.indexOf("app.on('before-quit'"));
    expect(fn).toContain('3000');
  });
});

// ─── AGENT42 — version 0.1.14 everywhere ─────────────────────────────────────
describe('AGENT42 — version 0.1.14 everywhere', () => {
  it('package.json versión es 0.1.14', () => {
    const pkg = JSON.parse(src('package.json'));
    expect(pkg.version).toBe('0.1.14');
  });
  it('APP_VERSION en agent-service.ts es 0.1.14', () => {
    const a = src('src/main/agent-service.ts');
    expect(a).toContain("const APP_VERSION = '0.1.14'");
  });
  it('api-client.ts usa appVersion como parámetro en enrollment (no hardcode)', () => {
    const a = src('src/main/api-client.ts');
    // La versión viene del parámetro, no de un literal hardcodeado
    expect(a).toContain('app_version: appVersion');
    expect(a).not.toContain("app_version: '0.1.14'");
  });
  it('index.html muestra v0.1.14 en barra de diagnóstico', () => {
    const h = src('src/renderer/index.html');
    expect(h).toContain('v0.1.14');
  });
  it('renderer actualiza #app-version con state.version', () => {
    const r = src('src/renderer/renderer.ts');
    expect(r).toContain('app-version');
    expect(r).toContain('state.version');
  });
});

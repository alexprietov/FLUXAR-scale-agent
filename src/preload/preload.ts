/**
 * Preload script — v3
 *
 * Expone IPC mínimo al renderer vía contextBridge.
 *
 * INVARIANTES DE SEGURIDAD:
 *   - El renderer NUNCA recibe: station_token, token_hash, enrollment_code
 *   - IPC devuelve solo: linked:bool + metadata segura
 *   - Renderer NO accede a: serialport, filesystem, safeStorage
 *
 * contextIsolation=true — este script corre en contexto privilegiado.
 * sandbox=false — OBLIGATORIO para que require('electron') funcione.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types.js';
import type {
  AppState, DeviceLocalConfig, DiagnosticReport,
  LocalTestConfig, LocalTestState,
} from '../shared/types.js';
import type { PortInfo } from '../main/serial-manager.js';

console.log('[Preload] START');

try {
  // API expuesta al renderer — sin secrets
  const fluxarApi = {
    // ─── Queries ──────────────────────────────────────────────────────────────

    getState: (): Promise<AppState | null> =>
      ipcRenderer.invoke(IPC.GET_STATE),

    listPorts: (): Promise<PortInfo[]> =>
      ipcRenderer.invoke(IPC.LIST_PORTS),

    getDiagnostic: (): Promise<DiagnosticReport | null> =>
      ipcRenderer.invoke(IPC.GET_DIAGNOSTIC),

    // ─── Acciones ─────────────────────────────────────────────────────────────

    /**
     * Enrollment — el resultado NUNCA incluye station_token.
     * El main process guarda el token internamente.
     */
    enroll: (enrollmentCode: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.ENROLL, enrollmentCode),

    saveDeviceConfig: (dc: DeviceLocalConfig): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SAVE_DEVICE_CONFIG, dc),

    setAutostart: (value: boolean): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SET_AUTOSTART, value),

    setStartMinimized: (value: boolean): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SET_START_MINIMIZED, value),

    refreshDevices: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.REFRESH_DEVICES),

    unlink: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.UNLINK),

    // ─── Prueba local (sin enrollment, sin backend) ────────────────────────────

    localTestStart: (config: LocalTestConfig): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.LOCAL_TEST_START, config),

    localTestStop: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.LOCAL_TEST_STOP),

    localTestGetState: (): Promise<LocalTestState | null> =>
      ipcRenderer.invoke(IPC.LOCAL_TEST_GET_STATE),

    localTestClearFrames: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.LOCAL_TEST_CLEAR_FRAMES),

    // ─── Push events ──────────────────────────────────────────────────────────

    onStateUpdate: (callback: (state: AppState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state);
      ipcRenderer.on(IPC.STATE_UPDATE, handler);
      return () => ipcRenderer.removeListener(IPC.STATE_UPDATE, handler);
    },

    onLocalTestUpdate: (callback: (state: LocalTestState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: LocalTestState) => callback(state);
      ipcRenderer.on(IPC.LOCAL_TEST_UPDATE, handler);
      return () => ipcRenderer.removeListener(IPC.LOCAL_TEST_UPDATE, handler);
    },
  };

  contextBridge.exposeInMainWorld('fluxar', fluxarApi);
  console.log('[Preload] FLUXAR_EXPOSED — methods:', Object.keys(fluxarApi).join(', '));

} catch (error) {
  console.error('[Preload] FAILED', error);
  throw error;
}

// Tipos para TypeScript en renderer
export type FluxarApi = Record<string, unknown>;

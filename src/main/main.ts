/**
 * FLUXAR Scale Agent — Main Process
 *
 * Electron main process:
 * - BrowserWindow con contextIsolation=true, nodeIntegration=false
 * - Tray con estados: Conectado / Sin conexión / Error de báscula
 * - IPC handlers (todos en main, nunca en renderer)
 * - safeStorage para token
 * - Autostart opcional
 */

import {
  app, BrowserWindow, Tray, Menu, ipcMain, nativeImage,
  shell, dialog,
} from 'electron';
import path from 'path';
import fs from 'fs';
import log from 'electron-log';
import { ConfigStore } from './config-store.js';
import { TokenStore } from './token-store.js';
import { AgentService } from './agent-service.js';
import { IPC } from '../shared/types.js';
import type { DeviceLocalConfig } from '../shared/types.js';

import { createRequire } from 'module';
const _require = createRequire(__filename);
const pkgVersion: string = (() => {
  try {
    const pkgPath = path.join(__dirname, '../../../package.json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = _require(pkgPath) as { version: string };
    return pkg.version;
  } catch {
    return '?.?.?';
  }
})();

// ─── Configuración de modo ────────────────────────────────────────────────────

const MOCK_MODE = process.env['SCALE_AGENT_MOCK_MODE'] === 'true' || process.env['NODE_ENV'] === 'development';

log.info(`[Main] FLUXAR Scale Agent v${pkgVersion} — modo: ${MOCK_MODE ? 'MOCK/DESARROLLO' : 'PRODUCCIÓN'}`);
if (MOCK_MODE) {
  log.warn('[Main] ⚠️  MODO DE PRUEBA ACTIVO — no se llama producción');
}

// ─── Globals ──────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agentService: AgentService | null = null;
let configStore: ConfigStore | null = null;
let tokenStore: TokenStore | null = null;

// ─── App ready ────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  log.transports.file.resolvePath = () => path.join(userDataPath, 'logs', 'main.log');

  // ── Diagnóstico de seguridad post-ready ──────────────────────────────────
  // safeStorage está disponible después de app.whenReady() en Electron >=15,
  // tanto en modo empaquetado como en modo fuente (npx electron .).
  // NO condicionar por app.isPackaged — eso causaba safeStorageRef=null en
  // modo fuente, haciendo fallar el enrollment con SafeStorageUnavailableError.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeStorageRef = (require('electron') as any).safeStorage ?? null;
  const safeStorageAvailable = safeStorageRef?.isEncryptionAvailable() === true;
  log.info('[Security] APP_READY');
  log.info(`[Security] SAFESTORAGE_AVAILABLE=${safeStorageAvailable}`);
  if (!safeStorageAvailable) {
    log.warn(`[Security] safeStorage no disponible — plataforma: ${process.platform}, packaged: ${app.isPackaged}, execPath: ${app.getPath('exe')}`);
  }

  configStore = new ConfigStore(userDataPath);
  tokenStore = new TokenStore(
    userDataPath,
    safeStorageRef,
    MOCK_MODE,
  );

  agentService = new AgentService(configStore, tokenStore, MOCK_MODE);

  // Escuchar cambios de estado para actualizar tray y renderer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentService.on('state-change', (state: any) => {
    updateTray(state.server_status, state.devices.some((d: { status: string }) => d.status === 'ERROR'));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.STATE_UPDATE, state);
    }
  });

  agentService.on('fetch-devices-error', (_errMsg: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fetch-devices-error');
    }
  });

  await agentService.initialize();

  createWindow();
  createTray();
  registerIpcHandlers();

  // ── Sincronizar Windows Login Item al arrancar ────────────────────────────
  // WINDOWS_LOGIN_ITEM_SYNC_ON_START: leer preferencia y sincronizar con OS.
  // Si no existe la key, default=true (instalación nueva).
  // Si ya existe (instalación previa), respetar la elección del usuario.
  //
  // WINDOWS --hidden: en Windows, wasOpenedAsHidden solo funciona si el
  // Login Item fue registrado con args: ['--hidden']. Sin ese argumento,
  // wasOpenedAsHidden siempre es false aunque la app arranque con Windows.
  // Electron 31 en Windows usa el registro de Windows (HKCU\Run) y pasa
  // los args al ejecutable. El main process detecta --hidden en argv.
  const cfg = configStore.get();
  const autostartPref = cfg.autostart ?? true;
  app.setLoginItemSettings({
    openAtLogin: autostartPref,
    // args: ['--hidden'] — Windows: pasar flag para que wasOpenedAsHidden=true
    // funcione correctamente. En macOS este campo se ignora.
    args: ['--hidden'],
  });
  log.info(`[Main] AUTOSTART_SYNC_ON_START: openAtLogin=${autostartPref}`);
});

// ─── Ventana principal ────────────────────────────────────────────────────────

function createWindow(): void {
  const cfg = configStore!.get();
  const bounds = cfg.window_bounds ?? { x: undefined, y: undefined, width: 900, height: 650 };

  // Con rootDir="src" en tsconfig.main.json, este archivo compila a:
  //   dist/main/main/main.js  → __dirname = dist/main/main/
  // Los artefactos de Electron están en:
  //   dist/preload/preload/preload.js  → ../../preload/preload/preload.js
  //   dist/renderer/index.html         → ../../renderer/index.html

  const preloadPath = path.join(__dirname, '../../preload/preload/preload.js');
  const preloadExists = fs.existsSync(preloadPath);
  log.info(`[Main] PRELOAD_PATH=${preloadPath}`);
  log.info(`[Main] PRELOAD_EXISTS=${preloadExists}`);
  if (!preloadExists) {
    log.error(`[Main] PRELOAD_ERROR: archivo no encontrado en ${preloadPath}`);
  }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 700,
    minHeight: 500,
    title: 'FLUXAR Scale Agent',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false — OBLIGATORIO para preloads que usan require('electron').
      // Con sandbox:true, require() está bloqueado en el preload y contextBridge
      // nunca se ejecuta, dejando window.fluxar undefined en el renderer.
      // contextIsolation:true sigue activo — eso es lo que realmente aísla el renderer.
      sandbox: false,
    },
    show: false,
    backgroundColor: '#0f172a',
  });

  const rendererPath = path.join(__dirname, '../../renderer/index.html');
  mainWindow.loadFile(rendererPath);

  mainWindow.once('ready-to-show', () => {
    // Semántica de inicio minimizado:
    // - APP ABIERTA MANUALMENTE (doble click, acceso directo): mostrar ventana.
    // - APP ABIERTA POR WINDOWS LOGIN (wasOpenedAsHidden=true): ocultar a tray
    //   si start_minimized está activo (default: true).
    // Esto evita que el doble click manual siempre desaparezca.
    //
    // WINDOWS --hidden: wasOpenedAsHidden solo es true si el Login Item fue
    // registrado con args: ['--hidden'] (ver AUTOSTART_SYNC_ON_START arriba).
    // Como fallback adicional, detectamos process.argv.includes('--hidden')
    // directamente — cubre el caso de instalaciones previas sin el arg.
    const wasAutoLaunched =
      app.getLoginItemSettings().wasOpenedAsHidden ||
      process.argv.includes('--hidden');
    const startMinimized  = configStore!.get().start_minimized ?? true;
    if (wasAutoLaunched && startMinimized) {
      // Abierto por Windows automáticamente + preferencia de inicio minimizado
      log.info('[Main] LAUNCH_HIDDEN: wasOpenedAsHidden=true, start_minimized=true');
    } else {
      // Lanzamiento manual o start_minimized=false → mostrar ventana
      log.info(`[Main] LAUNCH_VISIBLE: wasOpenedAsHidden=${wasAutoLaunched}, start_minimized=${startMinimized}`);
      mainWindow!.show();
    }
  });

  // ─── Diagnóstico de preload y renderer ────────────────────────────────────
  mainWindow.webContents.on('did-fail-load', (_e, errCode, errDesc, url) => {
    log.error(`[Main] DID_FAIL_LOAD: code=${errCode} desc=${errDesc} url=${url}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error(`[Main] RENDER_PROCESS_GONE: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on('preload-error', (_e, preloadPathErr, error) => {
    log.error(`[Main] PRELOAD_ERROR: path=${preloadPathErr} error=${String(error)}`);
  });

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    const prefix = level >= 3 ? '[Renderer][ERROR]' : level >= 2 ? '[Renderer][WARN]' : '[Renderer]';
    log.info(`${prefix} ${message}`);
  });

  // Guardar posición/tamaño al cerrar
  mainWindow.on('close', (e) => {
    if (!(app as AppWithQuit).isQuitting) {
      e.preventDefault();
      mainWindow!.hide();
      return;
    }
    const b = mainWindow!.getBounds();
    configStore!.setWindowBounds(b);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Abrir links externos en browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray(): void {
  // Usar icono genérico si no existe assets/icon.png
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('FLUXAR Scale Agent');
  updateTray('SIN_CONEXION', false);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function updateTray(serverStatus: string, hasError: boolean): void {
  if (!tray) return;

  let label = 'FLUXAR Scale Agent';
  if (hasError) label += '\nError de báscula';
  else if (serverStatus === 'CONECTADO') label += '\nConectado';
  else if (serverStatus === 'NO_AUTORIZADO') label += '\nNo autorizado';
  else label += '\nSin conexión';

  tray.setToolTip(label);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'FLUXAR Scale Agent', enabled: false },
    { label: serverStatus === 'CONECTADO' ? '● Conectado' : '○ Sin conexión', enabled: false },
    { type: 'separator' },
    {
      label: 'Abrir',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Salir de FLUXAR Scale Agent',
        click: async () => {
        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['Salir', 'Cancelar'],
          defaultId: 1,
          title: 'Salir',
          message: '¿Salir de FLUXAR Scale Agent?',
          detail: 'Las básculas dejarán de transmitir datos.',
        });
        if (response === 0) {
          (app as AppWithQuit).isQuitting = true;
          await agentService?.destroy();
          app.quit();
        }
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // GET_STATE
  ipcMain.handle(IPC.GET_STATE, () => {
    return agentService?.getAppState() ?? null;
  });

  // ENROLL
  ipcMain.handle(IPC.ENROLL, async (_event, enrollmentCode: string) => {
    if (!agentService) return { ok: false, error: 'Servicio no inicializado' };
    return agentService.enroll(enrollmentCode);
  });

  // LIST_PORTS
  ipcMain.handle(IPC.LIST_PORTS, async () => {
    return agentService?.listPorts() ?? [];
  });

  // SAVE_DEVICE_CONFIG
  ipcMain.handle(IPC.SAVE_DEVICE_CONFIG, async (_event, dc: DeviceLocalConfig) => {
    await agentService?.saveDeviceConfig(dc);
    return { ok: true };
  });

  // GET_DIAGNOSTIC
  ipcMain.handle(IPC.GET_DIAGNOSTIC, () => {
    return agentService?.getDiagnostic() ?? null;
  });

  // SET_AUTOSTART
  ipcMain.handle(IPC.SET_AUTOSTART, (_event, value: boolean) => {
    agentService?.setAutostart(value);
    // WINDOWS --hidden: siempre registrar con args: ['--hidden'] para que
    // wasOpenedAsHidden funcione correctamente en el próximo arranque.
    app.setLoginItemSettings({ openAtLogin: value, args: ['--hidden'] });
    return { ok: true };
  });

  // SET_START_MINIMIZED
  ipcMain.handle(IPC.SET_START_MINIMIZED, (_event, value: boolean) => {
    agentService?.setStartMinimized(value);
    return { ok: true };
  });

  // REFRESH_DEVICES
  ipcMain.handle(IPC.REFRESH_DEVICES, async () => {
    if (!agentService) return { ok: false, error: 'Servicio no inicializado' };
    return agentService.refreshDevices();
  });

  // UNLINK
  ipcMain.handle(IPC.UNLINK, async () => {
    await agentService?.unlink();
    return { ok: true };
  });

  // ─── Prueba local ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCAL_TEST_START, async (_event, config) => {
    if (!agentService) return { ok: false, error: 'Servicio no inicializado' };
    return agentService.localTestStart(config);
  });

  ipcMain.handle(IPC.LOCAL_TEST_STOP, async () => {
    await agentService?.localTestStop();
    return { ok: true };
  });

  ipcMain.handle(IPC.LOCAL_TEST_GET_STATE, () => {
    return agentService?.getLocalTestState() ?? null;
  });

  ipcMain.handle(IPC.LOCAL_TEST_CLEAR_FRAMES, () => {
    agentService?.clearLocalTestFrames();
    return { ok: true };
  });

  // Suscribir push de prueba local
  agentService?.onLocalTestUpdate((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.LOCAL_TEST_UPDATE, state);
    }
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Extender tipo de app para isQuitting
interface AppWithQuit extends Electron.App {
  isQuitting: boolean;
}
(app as AppWithQuit).isQuitting = false;

app.on('window-all-closed', () => {
  // No salir — minimizar a tray
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', async () => {
  (app as AppWithQuit).isQuitting = true;
  // Destruir el agente con timeout para no bloquear Windows shutdown.
  // Si destroy() tarda más de 3s, continuamos de todas formas.
  try {
    await Promise.race([
      agentService?.destroy() ?? Promise.resolve(),
      new Promise<void>(resolve => setTimeout(resolve, 3000)),
    ]);
  } catch { /* ignorar errores en shutdown */ }
});

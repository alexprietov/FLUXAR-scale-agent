/**
 * Renderer script — v4
 *
 * ARQUITECTURA RESISTENTE A FALLOS:
 *
 *   DOMContentLoaded
 *     ↓
 *   bindNavigationEvents()   ← PRIMERO — sin await, sin IPC, sin fluxar
 *     ↓
 *   renderInitialScreen()    ← muestra pantalla inicial
 *     ↓
 *   initializeFluxarBridge() ← DESPUÉS, aislado en try/catch
 *
 * Los botones de navegación NUNCA dependen de getFluxar()!.
 * Si window.fluxar es undefined, la navegación funciona igual.
 *
 * IMPORTANTE: Este archivo NO usa import/export de ES modules.
 * Se carga como <script src="renderer.js"> (script clásico, no type="module").
 * Todos los tipos están declarados inline para evitar que tsc emita
 * import statements en el JS compilado.
 *
 * NO accede a Node.js, serialport, filesystem, ni token.
 */

// ─── Tipos inline (sin import) ────────────────────────────────────────────────

interface DeviceState {
  scale_id: number;
  name: string;
  com_port: string | null;
  protocol: string;
  status: string;
  weight_kg: number | null;
  is_stable: boolean;
  serial_open: boolean;
  last_reading_at: number | null;   // Date.now() — número, no string
  last_error: string | null;
}

interface AppState {
  linked: boolean;
  station_id: number | null;
  station_name: string | null;
  station_branch: string | null;   // campo real de AppState
  branch_name: string | null;      // alias legacy — puede venir como null
  api_url: string | null;
  mock_mode: boolean;              // alias legacy — puede venir como undefined
  mode: 'MOCK' | 'PRODUCTION';    // campo real de AppState
  server_status: 'CONECTADO' | 'SIN_CONEXION' | 'NO_AUTORIZADO';
  devices: DeviceState[];
  autostart: boolean;
  start_minimized: boolean;
  version: string;
}

interface LocalTestState {
  running: boolean;
  port: string | null;
  baud: number;
  status: 'closed' | 'opening' | 'open' | 'error';
  error: string | null;
  weight_kg: number | null;
  is_stable: boolean;
  last_frame: string | null;
  raw_frames: Array<{ received_at: number; raw: string; parsed_weight: number | null }>;
}

interface PortInfo {
  path: string;
  manufacturer?: string;
}

interface FluxarBridge {
  getState(): Promise<AppState | null>;
  listPorts(): Promise<PortInfo[]>;
  getDiagnostic(): Promise<unknown>;
  enroll(code: string): Promise<{ ok: boolean; error?: string }>;
  saveDeviceConfig(cfg: {
    scale_id: number; com_port: string; protocol: string;
    baud_rate: number; data_bits: number; parity: string; stop_bits: number;
  }): Promise<{ ok: boolean; error?: string }>;
  setAutostart(on: boolean): Promise<{ ok: boolean }>;
  setStartMinimized(on: boolean): Promise<{ ok: boolean }>;
  refreshDevices(): Promise<{ ok: boolean; error?: string }>;
  unlink(): Promise<{ ok: boolean }>;
  onStateUpdate(cb: (s: AppState) => void): () => void;
  localTestStart(cfg: {
    com_port: string; baud_rate: number; data_bits: number;
    parity: string; stop_bits: number; protocol: string;
  }): Promise<{ ok: boolean; error?: string }>;
  localTestStop(): Promise<{ ok: true }>;
  localTestGetState(): Promise<LocalTestState | null>;
  localTestClearFrames(): Promise<{ ok: true }>;
  onLocalTestUpdate(cb: (s: LocalTestState) => void): () => void;
}

// ─── Acceso a window.fluxar sin augmentar el tipo global ─────────────────────
// Con module:"None", declare global no está disponible.
// Usamos un helper tipado para acceder a window.fluxar de forma segura.

function getFluxar(): FluxarBridge | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).fluxar as FluxarBridge | undefined;
}

// ─── Estado local del renderer ────────────────────────────────────────────────

let currentState: AppState | null = null;
let currentModalScaleId: number | null = null;
let autostartOn = false;
let startMinimizedOn = true;
let localTestUnsubscribe: (() => void) | null = null;

// ─── Helpers de diagnóstico de arranque ──────────────────────────────────────

function logDiag(msg: string): void {
  console.log('[renderer] ' + msg);
  updateStatusBar(msg);
}

function updateStatusBar(msg: string): void {
  const el = document.getElementById('diag-status-bar');
  if (el) el.textContent = msg;
}

// ─── PASO 1: Registrar navegación básica — SIN await, SIN IPC, SIN fluxar ────

function bindNavigationEvents(): void {
  console.log('[renderer] BIND_EVENTS_START');

  const btnLocal = document.getElementById('btn-go-local-test');
  const btnEnroll = document.getElementById('btn-go-enroll');
  const btnBackFromEnroll = document.getElementById('btn-back-from-enroll');
  const btnLtBack = document.getElementById('btn-lt-back');

  console.log('[renderer] LOCAL_BUTTON_FOUND=' + (btnLocal !== null));
  console.log('[renderer] ENROLL_BUTTON_FOUND=' + (btnEnroll !== null));

  if (btnLocal) {
    btnLocal.addEventListener('click', () => {
      console.log('[renderer] LOCAL_BUTTON_CLICK');
      showLocalTestUI();
    });
  }

  if (btnEnroll) {
    btnEnroll.addEventListener('click', () => {
      console.log('[renderer] ENROLL_BUTTON_CLICK');
      showEnrollUI();
    });
  }

  if (btnBackFromEnroll) {
    btnBackFromEnroll.addEventListener('click', () => {
      showUnlinkedUI();
    });
  }

  if (btnLtBack) {
    btnLtBack.addEventListener('click', () => {
      showUnlinkedUI();
    });
  }

  console.log('[renderer] BIND_EVENTS_COMPLETE');
}

// ─── PASO 2: Pantalla inicial ─────────────────────────────────────────────────

function renderInitialScreen(): void {
  // Por defecto mostramos page-unlinked (ya está visible en el HTML)
  // No hacemos nada aquí — el HTML ya tiene display:flex en page-unlinked
  console.log('[renderer] DOM_READY — pantalla inicial visible');
}

// ─── PASO 3: Inicializar bridge con fluxar — aislado en try/catch ─────────────

async function initializeFluxarBridge(): Promise<void> {
  const fluxarAvailable = getFluxar() != null;
  console.log('[renderer] FLUXAR_AVAILABLE=' + fluxarAvailable);

  if (!fluxarAvailable) {
    console.warn('[renderer] window.fluxar no disponible — navegación funciona, IPC no disponible');
    updateStatusBar('Renderer: OK | Servicio local: No disponible');
    return;
  }

  try {
    currentState = await getFluxar()!.getState();
    console.log('[renderer] getState =>', currentState ? 'linked=' + currentState.linked : 'null');

    if (currentState) {
      render(currentState);
    }

    getFluxar()!.onStateUpdate((state) => {
      currentState = state;
      render(state);
    });

    updateStatusBar('Renderer: OK | Servicio local: OK');
  } catch (err) {
    console.error('[renderer] initializeFluxarBridge error:', err);
    updateStatusBar('Renderer: OK | Servicio local: Error');
  }

  // Registrar el resto de eventos que SÍ necesitan fluxar
  bindFluxarEvents();
}

// ─── Punto de entrada principal ───────────────────────────────────────────────

async function init(): Promise<void> {
  console.log('[renderer] INIT_START');

  // Capturar errores globales para diagnóstico
  window.onerror = (msg, src, line, col, err) => {
    console.error('[renderer] UNCAUGHT_ERROR:', msg, 'at', src + ':' + line + ':' + col, err);
    return false;
  };
  window.onunhandledrejection = (ev) => {
    console.error('[renderer] UNHANDLED_REJECTION:', ev.reason);
  };

  // PASO 1: Navegación básica — PRIMERO, sin ninguna dependencia externa
  bindNavigationEvents();

  // PASO 2: Pantalla inicial
  renderInitialScreen();

  // PASO 3: Bridge con fluxar — después, aislado
  await initializeFluxarBridge();
}

// ─── Navegación de pantallas ──────────────────────────────────────────────────

function showLocalTestUI(): void {
  console.log('[renderer] showLocalTestUI() — navegando INMEDIATAMENTE');

  // 1. Cambiar pantalla de forma síncrona — sin await
  const pageUnlinked = document.getElementById('page-unlinked');
  const pageEnroll = document.getElementById('page-enroll');
  const pageLocalTest = document.getElementById('page-local-test');
  const nav = document.getElementById('nav');

  if (pageUnlinked) pageUnlinked.style.display = 'none';
  if (pageEnroll) pageEnroll.style.display = 'none';
  if (nav) nav.style.display = 'none';

  // Ocultar páginas de app vinculada
  document.querySelectorAll('.page').forEach(p => (p as HTMLElement).style.display = 'none');

  if (pageLocalTest) {
    pageLocalTest.classList.add('active');
  }

  console.log('[renderer] page-local-test activa');

  // 2. Suscribir a updates de prueba local (solo si fluxar disponible)
  if (getFluxar() != null) {
    if (localTestUnsubscribe) localTestUnsubscribe();
    localTestUnsubscribe = getFluxar()!.onLocalTestUpdate((state) => {
      renderLocalTestState(state);
    });

    // 3. Cargar puertos y estado DESPUÉS de mostrar la pantalla
    refreshPorts().catch((err: unknown) => {
      console.error('[renderer] refreshPorts error:', err);
      showPortsError('No se pudieron consultar los puertos');
    });

    getFluxar()!.localTestGetState().then((ltState) => {
      if (ltState) renderLocalTestState(ltState);
    }).catch(() => { /* ignorar */ });
  } else {
    // Sin fluxar: mostrar mensaje informativo pero la pantalla SÍ abre
    showPortsError('No se pudo conectar con el servicio local del agente.');
  }
}

function showEnrollUI(): void {
  console.log('[renderer] showEnrollUI() — navegando INMEDIATAMENTE');

  const pageUnlinked = document.getElementById('page-unlinked');
  const pageEnroll = document.getElementById('page-enroll');
  const pageLocalTest = document.getElementById('page-local-test');

  if (pageUnlinked) pageUnlinked.style.display = 'none';
  if (pageLocalTest) pageLocalTest.classList.remove('active');
  document.querySelectorAll('.page').forEach(p => (p as HTMLElement).style.display = 'none');

  if (pageEnroll) pageEnroll.style.display = 'flex';

  console.log('[renderer] page-enroll activa');
}

function showUnlinkedUI(): void {
  const pageUnlinked = document.getElementById('page-unlinked');
  const pageEnroll = document.getElementById('page-enroll');
  const pageLocalTest = document.getElementById('page-local-test');

  if (pageEnroll) pageEnroll.style.display = 'none';
  if (pageLocalTest) pageLocalTest.classList.remove('active');
  document.querySelectorAll('.page').forEach(p => (p as HTMLElement).style.display = 'none');

  if (pageUnlinked) pageUnlinked.style.display = 'flex';

  // Detener prueba local si estaba corriendo
  if (getFluxar() != null) {
    getFluxar()!.localTestStop().catch(() => {});
  }
  if (localTestUnsubscribe) {
    localTestUnsubscribe();
    localTestUnsubscribe = null;
  }
}

// ─── Render principal (app vinculada) ─────────────────────────────────────────

function render(state: AppState): void {
  const nav = document.getElementById('nav');
  const pageUnlinked = document.getElementById('page-unlinked');
  const pageEnroll = document.getElementById('page-enroll');
  const pageLocalTest = document.getElementById('page-local-test');
  const modeBadge = document.getElementById('mode-badge');
  const mockBanner = document.getElementById('mock-banner');

  if (state.linked) {
    if (pageUnlinked) pageUnlinked.style.display = 'none';
    if (pageEnroll) pageEnroll.style.display = 'none';
    if (pageLocalTest) pageLocalTest.classList.remove('active');
    if (nav) nav.style.display = 'flex';

    // Mostrar página activa
    const activeTab = document.querySelector('.nav-tab.active');
    const activePage = activeTab ? (activeTab as HTMLElement).dataset['page'] : 'main';
    showPage(activePage || 'main');

    // Actualizar info de estación
    const stationName = document.getElementById('station-name');
    const stationBranch = document.getElementById('station-branch');
    const settingsStationName = document.getElementById('settings-station-name');
    const settingsStationBranch = document.getElementById('settings-station-branch');

    if (stationName) stationName.textContent = state.station_name || '—';
    if (stationBranch) stationBranch.textContent = state.station_branch || state.branch_name || '—';
    if (settingsStationName) settingsStationName.textContent = state.station_name || '—';
    if (settingsStationBranch) settingsStationBranch.textContent = state.station_branch || state.branch_name || '—';

    // Versión del agente (autoridad: AppState.version desde APP_VERSION en agent-service)
    const appVersionEl = document.getElementById('app-version');
    if (appVersionEl && state.version) appVersionEl.textContent = state.version;

    // Modo
    if (modeBadge) {
      const isMock = state.mode === 'MOCK' || state.mock_mode === true;
      modeBadge.textContent = isMock ? 'Modo de prueba' : 'Producción';
      modeBadge.className = 'mode-badge ' + (isMock ? 'mock' : 'prod');
    }
    if (mockBanner) {
      mockBanner.className = (state.mode === 'MOCK' || state.mock_mode === true) ? 'visible' : '';
    }

    // API URL
    const settingsApiUrl = document.getElementById('settings-api-url');
    const settingsApiSection = document.getElementById('settings-api-section');
    if (state.api_url && settingsApiUrl && settingsApiSection) {
      settingsApiUrl.textContent = state.api_url;
      settingsApiSection.style.display = 'block';
    }

    // Autostart
    autostartOn = state.autostart;
    const toggleAutostart = document.getElementById('toggle-autostart');
    if (toggleAutostart) {
      toggleAutostart.className = 'toggle' + (autostartOn ? ' on' : '');
    }

    startMinimizedOn = state.start_minimized ?? true;
    const toggleStartMinimized = document.getElementById('toggle-start-minimized');
    if (toggleStartMinimized) {
      toggleStartMinimized.className = 'toggle' + (startMinimizedOn ? ' on' : '');
    }

    // Dispositivos
    renderDevices(state.devices);

    // Conexión — basado en server_status real, NO solo en linked
    updateConnectionStatus(state.server_status);
  } else {
    if (nav) nav.style.display = 'none';
    if (pageUnlinked) pageUnlinked.style.display = 'flex';
  }
}

function showPage(name: string): void {
  document.querySelectorAll('.page').forEach(p => {
    (p as HTMLElement).style.display = 'none';
  });
  const page = document.getElementById('page-' + name);
  if (page) page.style.display = 'block';

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', (t as HTMLElement).dataset['page'] === name);
  });
}

function updateConnectionStatus(status: 'CONECTADO' | 'SIN_CONEXION' | 'NO_AUTORIZADO'): void {
  const dot = document.getElementById('server-dot');
  const label = document.getElementById('server-label');
  if (!dot || !label) return;

  if (status === 'CONECTADO') {
    dot.className = 'connected';
    label.textContent = 'Conectado';
  } else if (status === 'NO_AUTORIZADO') {
    dot.className = 'auth-error';
    label.textContent = 'Error de autenticación — requiere volver a vincular';
  } else {
    dot.className = 'disconnected';
    label.textContent = 'Sin conexión';
  }
}

// ─── Render dispositivos ──────────────────────────────────────────────────────

function renderDevices(devices: DeviceState[]): void {
  const list = document.getElementById('devices-list');
  if (!list) return;

  if (!devices || devices.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>Sin básculas configuradas</h3>
        <p>Configura las básculas desde el módulo de Básculas en FLUXAR.</p>
      </div>`;
    return;
  }

  const cards = devices.map(d => {
    try {
      return renderDeviceCard(d);
    } catch (err) {
      // Un device con datos inesperados no colapsa toda la lista
      console.error('[renderer] renderDeviceCard error para scale_id=' + d.scale_id + ':', err);
      return `<div class="device-card device-card-error">
        <div class="device-name">${escHtml(canonicalDeviceName(d))}</div>
        <div class="device-error">Error al renderizar este dispositivo</div>
      </div>`;
    }
  });

  list.innerHTML = cards.join('');
}

function renderDeviceCard(d: DeviceState): string {
  // ── Nombre canónico — nunca undefined
  const displayName = canonicalDeviceName(d);

  // ── Peso
  const hasWeight = typeof d.weight_kg === 'number' && Number.isFinite(d.weight_kg);
  const weightText = hasWeight ? (d.weight_kg as number).toFixed(2) + ' kg' : '— kg';
  const weightNonPositive = hasWeight && (d.weight_kg as number) <= 0;

  // ── Estabilidad
  const stabilityLabel = d.is_stable ? 'ESTABLE' : 'EN MOVIMIENTO';
  const stabilityClass = d.is_stable ? 'stability-stable' : 'stability-moving';

  // ── Capturable (indicador visual — backend es autoridad)
  const showNotCapturable = hasWeight && (weightNonPositive || !d.is_stable || !d.serial_open);

  // ── Conexión serial
  const serialLabel = d.serial_open ? 'Conectada' : 'Desconectada';
  const serialClass = d.serial_open ? 'serial-open' : 'serial-closed';

  // ── Última lectura
  let lastReadLabel = '—';
  if (d.last_reading_at) {
    const agoMs = Date.now() - d.last_reading_at;
    if (agoMs < 5000) lastReadLabel = 'ahora';
    else if (agoMs < 60000) lastReadLabel = `hace ${Math.floor(agoMs / 1000)}s`;
    else lastReadLabel = new Date(d.last_reading_at).toLocaleTimeString('es-MX');
  }

  // ── Meta serial
  const comPort = d.com_port || '—';
  const protocol = (d as unknown as { protocol?: string }).protocol || '—';
  const metaSerial = `${escHtml(comPort)} · ${escHtml(protocol)}`;

  // ── Error
  const errorHtml = d.last_error
    ? `<div class="device-error">${escHtml(d.last_error)}</div>`
    : '';

  return `
    <div class="device-card">
      <div class="device-header">
        <div class="device-name">${escHtml(displayName)}</div>
        <div class="device-serial-badge ${serialClass}">${serialLabel}</div>
      </div>
      <div class="device-weight-row">
        <span class="device-weight-value">${weightText}</span>
        ${showNotCapturable ? '<span class="device-not-capturable">NO CAPTURABLE</span>' : ''}
      </div>
      <div class="device-stability ${stabilityClass}">${stabilityLabel}</div>
      <div class="device-footer">
        <span class="device-meta">${metaSerial}</span>
        <span class="device-last-read">Última lectura: ${lastReadLabel}</span>
      </div>
      ${errorHtml}
    </div>`;
}
// ─── Render prueba local ──────────────────────────────────────────────────────

function renderLocalTestState(state: LocalTestState): void {
  const dot = document.getElementById('lt-status-dot');
  const label = document.getElementById('lt-status-label');
  const weightDisplay = document.getElementById('lt-weight-display');
  const stabilityBadge = document.getElementById('lt-stability-badge');
  const lastFrame = document.getElementById('lt-last-frame');
  const framesList = document.getElementById('lt-frames-list');
  const btnOpen = document.getElementById('btn-lt-open') as HTMLButtonElement | null;
  const btnClose = document.getElementById('btn-lt-close') as HTMLButtonElement | null;

  if (dot) {
    dot.className = 'lt-status-dot' + (state.status === 'open' ? ' open' : state.status === 'error' ? ' error' : '');
  }
  if (label) {
    const labels: Record<string, string> = {
      closed: 'Puerto cerrado', opening: 'Abriendo...', open: 'Puerto abierto', error: 'Error',
    };
    label.textContent = labels[state.status] || state.status;
  }

  if (weightDisplay) {
    const w = (typeof state.weight_kg === 'number' && Number.isFinite(state.weight_kg))
      ? state.weight_kg.toFixed(2) + ' kg'
      : '— kg';
    weightDisplay.textContent = w;
    weightDisplay.className = 'lt-weight-display' + (state.weight_kg !== null ? (state.is_stable ? ' stable' : ' has-data') : '');
  }

  if (stabilityBadge) {
    if (state.weight_kg === null) {
      stabilityBadge.className = 'lt-stability no-data';
      stabilityBadge.textContent = 'Sin datos';
    } else if (state.is_stable) {
      stabilityBadge.className = 'lt-stability stable';
      stabilityBadge.textContent = 'Estable';
    } else {
      stabilityBadge.className = 'lt-stability unstable';
      stabilityBadge.textContent = 'Inestable';
    }
  }

  if (lastFrame) {
    lastFrame.textContent = state.last_frame || '—';
  }

  if (framesList && state.raw_frames) {
    if (state.raw_frames.length === 0) {
      framesList.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px 0;">Sin tramas aún.</div>';
    } else {
      framesList.innerHTML = state.raw_frames.slice().reverse().map(f => {
        // RawFrame: received_at (number), raw (string), parsed_weight (number|null)
        const t = typeof f.received_at === 'number' && Number.isFinite(f.received_at)
          ? new Date(f.received_at).toLocaleTimeString()
          : '--:--:--';
        const w = typeof f.parsed_weight === 'number' && Number.isFinite(f.parsed_weight)
          ? f.parsed_weight.toFixed(2) + ' kg'
          : '';
        return `<div class="lt-frame-item">
          <span class="lt-frame-time">${t}</span>
          <span class="lt-frame-raw">${escHtml(f.raw.slice(0, 256))}</span>
          ${w ? `<span class="lt-frame-weight">${w}</span>` : ''}
        </div>`;
      }).join('');
    }
  }

  if (btnOpen) btnOpen.disabled = state.status === 'open' || state.status === 'opening';
  if (btnClose) btnClose.disabled = state.status !== 'open';
}

// ─── Puertos ──────────────────────────────────────────────────────────────────

async function refreshPorts(): Promise<void> {
  const select = document.getElementById('lt-com-port') as HTMLSelectElement | null;
  const modalSelect = document.getElementById('modal-com-port') as HTMLSelectElement | null;

  if (!select) return;

  let ports: PortInfo[] = [];
  try {
    ports = await getFluxar()!.listPorts();
  } catch (err) {
    console.error('[renderer] listPorts threw:', err);
    throw err;
  }

  const buildOptions = (sel: HTMLSelectElement): void => {
    const prev = sel.value;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = ports.length === 0 ? 'No se encontraron puertos COM' : 'Seleccionar puerto...';
    sel.appendChild(placeholder);
    ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path;
      opt.textContent = p.path + (p.manufacturer ? ' — ' + p.manufacturer : '');
      sel.appendChild(opt);
    });
    if (prev && ports.some(p => p.path === prev)) sel.value = prev;
  };

  buildOptions(select);
  if (modalSelect) buildOptions(modalSelect);
}

function showPortsError(msg: string): void {
  const errEl = document.getElementById('lt-open-error');
  if (errEl) {
    errEl.textContent = msg;
    errEl.className = 'error-msg visible';
  }
}

// ─── Eventos que requieren window.fluxar ──────────────────────────────────────

function bindFluxarEvents(): void {
  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const page = (tab as HTMLElement).dataset['page'];
      if (page) {
        showPage(page);
        if (page === 'diagnostic') loadDiagnostic();
      }
    });
  });

  // Prueba local: abrir puerto
  const btnOpen = document.getElementById('btn-lt-open');
  if (btnOpen) {
    btnOpen.addEventListener('click', async () => {
      const port = (document.getElementById('lt-com-port') as HTMLSelectElement)?.value;
      const baud = parseInt((document.getElementById('lt-baud') as HTMLSelectElement)?.value || '9600');
      const dataBits = parseInt((document.getElementById('lt-databits') as HTMLSelectElement)?.value || '8');
      const parity = (document.getElementById('lt-parity') as HTMLSelectElement)?.value || 'none';
      const stopBits = parseInt((document.getElementById('lt-stopbits') as HTMLSelectElement)?.value || '1');
      const protocol = (document.getElementById('lt-protocol') as HTMLSelectElement)?.value || 'GENERIC';

      console.log(`[renderer] LOCAL_TEST_OPEN_REQUEST com_port=${port} baud_rate=${baud} data_bits=${dataBits} parity=${parity} stop_bits=${stopBits} protocol=${protocol}`);

      const errEl = document.getElementById('lt-open-error');
      if (errEl) errEl.className = 'error-msg';

      if (!port || !port.trim()) {
        showPortsError('Selecciona un puerto COM.');
        return;
      }

      try {
        // Normalización explícita: renderer usa nombres cortos, LocalTestConfig usa snake_case
        const config = {
          com_port: port,
          baud_rate: baud,
          data_bits: dataBits,
          parity,
          stop_bits: stopBits,
          protocol,
        };
        const result = await getFluxar()!.localTestStart(config);
        if (!result.ok) showPortsError(result.error || 'Error al abrir el puerto.');
      } catch (err) {
        showPortsError('Error al abrir el puerto: ' + String(err));
      }
    });
  }

  // Prueba local: cerrar puerto
  const btnClose = document.getElementById('btn-lt-close');
  if (btnClose) {
    btnClose.addEventListener('click', async () => {
      try { await getFluxar()!.localTestStop(); } catch { /* ignorar */ }
    });
  }

  // Prueba local: limpiar tramas
  const btnClear = document.getElementById('btn-lt-clear-frames');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      try { await getFluxar()!.localTestClearFrames(); } catch { /* ignorar */ }
    });
  }

  // Prueba local: actualizar puertos
  const btnRefresh = document.getElementById('btn-lt-refresh-ports');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      refreshPorts().catch((err: unknown) => showPortsError('No se pudieron consultar los puertos: ' + String(err)));
    });
  }

  // Enrollment: vincular
  const btnEnrollSubmit = document.getElementById('btn-enroll');
  if (btnEnrollSubmit) {
    btnEnrollSubmit.addEventListener('click', async () => {
      const code = ((document.getElementById('enroll-code') as HTMLInputElement)?.value || '').trim().toLowerCase().replace(/-/g, '');
      const errEl = document.getElementById('enroll-error');
      if (errEl) errEl.className = 'error-msg';

      if (!code) {
        if (errEl) { errEl.textContent = 'Ingresa el código de vinculación.'; errEl.className = 'error-msg visible'; }
        return;
      }

      (btnEnrollSubmit as HTMLButtonElement).disabled = true;
      (btnEnrollSubmit as HTMLButtonElement).textContent = 'Vinculando...';

      try {
        const result = await getFluxar()!.enroll(code);
        if (result.ok) {
          // El estado se actualizará vía onStateUpdate
        } else {
          if (errEl) { errEl.textContent = result.error || 'Código inválido o expirado.'; errEl.className = 'error-msg visible'; }
          (btnEnrollSubmit as HTMLButtonElement).disabled = false;
          (btnEnrollSubmit as HTMLButtonElement).textContent = 'VINCULAR';
        }
      } catch (err) {
        if (errEl) { errEl.textContent = 'Error de conexión: ' + String(err); errEl.className = 'error-msg visible'; }
        (btnEnrollSubmit as HTMLButtonElement).disabled = false;
        (btnEnrollSubmit as HTMLButtonElement).textContent = 'VINCULAR';
      }
    });
  }

  // Configuración: autostart
  const toggleAutostart = document.getElementById('toggle-autostart');
  if (toggleAutostart) {
    toggleAutostart.addEventListener('click', async () => {
      autostartOn = !autostartOn;
      toggleAutostart.className = 'toggle' + (autostartOn ? ' on' : '');
      try { await getFluxar()!.setAutostart(autostartOn); } catch { /* ignorar */ }
    });
  }

  // Configuración: inicio minimizado
  const toggleStartMinimized = document.getElementById('toggle-start-minimized');
  if (toggleStartMinimized) {
    toggleStartMinimized.addEventListener('click', async () => {
      startMinimizedOn = !startMinimizedOn;
      toggleStartMinimized.className = 'toggle' + (startMinimizedOn ? ' on' : '');
      try { await getFluxar()!.setStartMinimized(startMinimizedOn); } catch { /* ignorar */ }
    });
  }

  // Botón: Actualizar configuración
  const btnRefreshConfig = document.getElementById('btn-refresh-config');
  if (btnRefreshConfig) {
    btnRefreshConfig.addEventListener('click', async () => {
      btnRefreshConfig.textContent = 'Actualizando...';
      (btnRefreshConfig as HTMLButtonElement).disabled = true;
      try {
        const result = await getFluxar()!.refreshDevices();
        btnRefreshConfig.textContent = result?.ok ? 'Configuración actualizada' : 'No se pudo actualizar';
      } catch {
        btnRefreshConfig.textContent = 'No se pudo actualizar';
      } finally {
        setTimeout(() => {
          btnRefreshConfig.textContent = 'Actualizar configuración';
          (btnRefreshConfig as HTMLButtonElement).disabled = false;
        }, 2500);
      }
    });
  }

  // Configuración: desvincular
  const btnUnlink = document.getElementById('btn-unlink');
  if (btnUnlink) {
    btnUnlink.addEventListener('click', async () => {
      if (!confirm('¿Desvincular esta estación? Necesitarás un nuevo código para volver a vincularla.')) return;
      try { await getFluxar()!.unlink(); } catch { /* ignorar */ }
    });
  }

  // Modal: cancelar
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  if (btnModalCancel) {
    btnModalCancel.addEventListener('click', () => {
      const modal = document.getElementById('modal-device');
      if (modal) modal.className = 'modal-overlay hidden';
    });
  }

  // Modal: guardar
  const btnModalSave = document.getElementById('btn-modal-save');
  if (btnModalSave) {
    btnModalSave.addEventListener('click', async () => {
      if (currentModalScaleId === null) return;
      const comPort = (document.getElementById('modal-com-port') as HTMLSelectElement)?.value;
      const protocol = (document.getElementById('modal-protocol') as HTMLSelectElement)?.value;
      const baud = parseInt((document.getElementById('modal-baud') as HTMLInputElement)?.value || '9600');
      const dataBits = parseInt((document.getElementById('modal-databits') as HTMLSelectElement)?.value || '8');
      const parity = (document.getElementById('modal-parity') as HTMLSelectElement)?.value || 'none';
      const stopBits = parseInt((document.getElementById('modal-stopbits') as HTMLSelectElement)?.value || '1');

      const errEl = document.getElementById('modal-error');
      const successEl = document.getElementById('modal-success');
      if (errEl) errEl.className = 'error-msg';
      if (successEl) successEl.className = 'success-msg';

      if (!comPort) {
        if (errEl) { errEl.textContent = 'Selecciona un puerto COM.'; errEl.className = 'error-msg visible'; }
        return;
      }

      try {
        const result = await getFluxar()!.saveDeviceConfig({
          scale_id: currentModalScaleId, com_port: comPort, protocol,
          baud_rate: baud, data_bits: dataBits, parity, stop_bits: stopBits,
        });
        if (result.ok) {
          if (successEl) { successEl.textContent = 'Configuración guardada.'; successEl.className = 'success-msg visible'; }
          setTimeout(() => {
            const modal = document.getElementById('modal-device');
            if (modal) modal.className = 'modal-overlay hidden';
          }, 1200);
        } else {
          if (errEl) { errEl.textContent = result.error || 'Error al guardar.'; errEl.className = 'error-msg visible'; }
        }
      } catch (err) {
        if (errEl) { errEl.textContent = 'Error: ' + String(err); errEl.className = 'error-msg visible'; }
      }
    });
  }

  // Diagnóstico
  const btnRefreshDiag = document.getElementById('btn-refresh-diag');
  if (btnRefreshDiag) {
    btnRefreshDiag.addEventListener('click', loadDiagnostic);
  }

  const btnCopyDiag = document.getElementById('btn-copy-diag');
  if (btnCopyDiag) {
    btnCopyDiag.addEventListener('click', () => {
      const content = document.getElementById('diag-content')?.textContent || '';
      navigator.clipboard.writeText(content).catch(() => {});
    });
  }
}

// ─── Modal de dispositivo ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).openDeviceModal = function(scaleId: number): void {
  currentModalScaleId = scaleId;
  const device = currentState?.devices.find(d => d.scale_id === scaleId);
  if (!device) return;

  const modal = document.getElementById('modal-device');
  const modalName = document.getElementById('modal-device-name');
  const modalProtocol = document.getElementById('modal-protocol') as HTMLSelectElement | null;
  const modalBaud = document.getElementById('modal-baud') as HTMLInputElement | null;

  if (modalName) modalName.textContent = device.name;
  if (modalProtocol) modalProtocol.value = device.protocol;
  if (modalBaud) modalBaud.value = '9600';

  const errEl = document.getElementById('modal-error');
  const successEl = document.getElementById('modal-success');
  if (errEl) errEl.className = 'error-msg';
  if (successEl) successEl.className = 'success-msg';

  refreshPorts().catch(() => {});

  if (modal) modal.className = 'modal-overlay';
};

// ─── Diagnóstico ──────────────────────────────────────────────────────────────

async function loadDiagnostic(): Promise<void> {
  const content = document.getElementById('diag-content');
  if (!content) return;
  content.textContent = 'Cargando...';
  try {
    const diag = await getFluxar()!.getDiagnostic();
    content.textContent = JSON.stringify(diag, null, 2);
  } catch (err) {
    content.textContent = 'Error al cargar diagnóstico: ' + String(err);
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

/**
 * escHtml — escapa HTML de forma segura.
 * Acepta string | undefined | null para que un campo faltante en el DTO
 * nunca cause un TypeError: Cannot read properties of undefined (reading 'replace').
 */
function escHtml(str: string | undefined | null): string {
  if (str == null) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * canonicalDeviceName — nombre canónico de un dispositivo.
 * Si el campo name está vacío o undefined, usa "Báscula #<id>" como fallback.
 * Nunca retorna undefined ni lanza excepción.
 */
function canonicalDeviceName(d: DeviceState): string {
  const n = (d as unknown as { name?: string | null }).name;
  if (n && n.trim().length > 0) return n.trim();
  return `Báscula #${d.scale_id}`;
}

// ─── Arrancar ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

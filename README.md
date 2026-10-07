# FLUXAR Scale Agent

Conector de básculas para FLUXAR ERP.

Versión: 0.1.0

## Arquitectura

```
BÁSCULA FÍSICA
  → Puerto serial/COM
  → FLUXAR Scale Agent (Electron, Windows)
  → HTTPS
  → FLUXAR ERP
  → Pesaje
```

## Stack

- Electron 31
- Node.js 20 / TypeScript
- serialport 12
- electron-log, uuid

## Seguridad

- `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true`
- Station token cifrado con `safeStorage.encryptString()` (producción)
- Si `safeStorage.isEncryptionAvailable() === false` → enrollment abortado, error al operador
- Base64 NUNCA como fallback de producción
- Token NUNCA en logs, NUNCA expuesto al renderer
- Renderer accede solo a IPC mínimo vía preload

## Modos de operación

### Modo producción (normal)
```
FLUXAR Scale Agent → enrollment → FLUXAR ERP
```

### Modo de prueba (MOCK)
```
SCALE_AGENT_MOCK_MODE=true npm run dev
```
- No llama producción
- Simula dispositivos y lecturas
- Banner visible: "MODO DE PRUEBA"

### Modo PRUEBA LOCAL
- Sin enrollment, sin backend, sin company, sin branch
- Accesible desde la pestaña "Prueba Local" en la UI
- Banner visible: "PRUEBA LOCAL — NO ENVÍA DATOS A FLUXAR"
- Permite: listar COM, elegir puerto, ver trama, peso, estabilidad

## Para el operador final

**Instalar desde GitHub Actions:**

1. Ir a: `Actions → Scale Agent — Windows Build → último run exitoso`
2. Descargar `FLUXAR-Scale-Agent-Setup-Windows-x64`
3. Ejecutar el instalador `.exe`
4. No se requiere Visual Studio Build Tools ni Node.js

## Para el desarrollador

```bash
cd apps/scale-agent
npm ci
npm test             # Tests A01-A32
npm run type-check   # TypeScript check
npm run dev          # Electron en modo desarrollo (mock)
```

### Build Windows (en Windows o CI)

```bash
npm ci
npx electron-builder install-app-deps   # recompila serialport para Electron
npm run build:main && npm run build:preload
node scripts/copy-renderer.js
npx electron-builder --win --x64
# → release/FLUXAR-Scale-Agent-Setup-0.1.0.exe
# → release/FLUXAR-Scale-Agent-Portable-0.1.0.exe
```

## GitHub Actions

Workflow: `.github/workflows/scale-agent-windows.yml`

Runner: `windows-latest`

Pasos:
1. checkout
2. setup-node 20
3. npm ci
4. electron-builder install-app-deps (recompila serialport)
5. Tests A01-A32
6. TypeScript check
7. Build TypeScript
8. electron-builder (NSIS + portable)
9. Upload artifacts (30 días)

**Disparar manualmente:**
```
GitHub → Actions → Scale Agent — Windows Build → Run workflow
```

## Tests A01-A32

```
A01: Token no plaintext en config
A02: Mock mode no llama producción
A03: SerialPort.list mapping
A04: Dispositivo A falla sin detener B
A05: Parser generic text
A06: BASYS parser / pending fixture
A07: Stability — muestras insuficientes
A08: Stability — rango inestable
A09: Stability — estable
A10: Máx 1 update/s/device
A11: Retry conserva external UUID
A12: Heartbeat
A13: Revoked/401 → estado no autorizado
A14: Offline continúa serial
A15: Reconnect backoff
A16: Queue bounded
A17: Old queued reading conserva timestamp
A18: Multiple scales independent
A19: COM mapping station-specific
A20: raw_payload <= 4096
A21: Token/enrollment no logueados
A22: Diagnostic excluye secrets
A23: Packaged mode sin safeStorage → token NO persistido
A24: Packaged mode nunca usa Base64 fallback
A25: Renderer nunca recibe station token
A26: Local-test mode no llama API
A27: Local-test mode puede listar puertos sin enrollment
A28: Raw-frame viewer bounded a 10
A29: Raw-frame viewer no persiste por defecto
A30: Runtime sin COM4 hardcoded
A31: Retry mantiene seguridad del token
A32: Diagnostics siguen excluyendo secrets
```

## BASYS_FORMAT_NEEDS_REAL_SAMPLE

El parser BASYS está implementado con el formato parcialmente conocido:
`ST,GS,  12480.5 kg` / `US,GS,  12480.5 kg`

Usar el **Modo PRUEBA LOCAL** → "Ver tramas" para capturar el formato real de la báscula física.
Máximo 10 tramas en memoria, no persistidas, no enviadas al servidor.

## Versiones exactas

| Componente | Versión |
|---|---|
| Electron | 31.x |
| Node.js (CI) | 20.x |
| serialport | 12.x |
| electron-builder | 24.x |

Lockfile: `package-lock.json` (obligatorio, no usar versiones flotantes críticas)

## Notas importantes

- COM port es configuración LOCAL de cada PC — nunca global de la báscula
- El backend determina tenant (company_id/branch_id) desde el station token
- El agente NO tiene botón "TOMAR PESO" — eso pertenece al ERP/Pesaje
- Heartbeat cada 10s; offline queue máx 100 lecturas/device
- device_read_at NUNCA se modifica — conserva timestamp real
- serialport requiere recompilación para Electron (electron-builder install-app-deps)

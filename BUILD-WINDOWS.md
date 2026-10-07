# FLUXAR Scale Agent — Guía de Build Windows

## Versión: 0.1.14

---

## REQUISITOS PREVIOS (en la PC Windows donde se hace el build)

1. **Node.js 20 LTS** — https://nodejs.org/en/download
   - Verificar: `node --version` → debe mostrar v20.x o v22.x
2. **Git** — https://git-scm.com/download/win (opcional, para clonar)
3. **Visual Studio Build Tools** — requerido por `serialport` (addon nativo)
   - Instalar: `npm install -g windows-build-tools` (como Administrador)
   - O instalar manualmente: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   - Seleccionar: "Desarrollo de escritorio con C++"

---

## PASOS DE BUILD

### 1. Obtener el código fuente

**Opción A — Desde el TAR del ERP:**
```
Descargar: https://ecorecycler.app/api/downloads/scale-agent/latest
Extraer el TAR en una carpeta, p.ej. C:\fluxar-build\
Navegar a: C:\fluxar-build\FLUXAR-Scale-Agent-0.1.14\
```

**Opción B — Desde el repositorio:**
```
git clone <repo-url>
cd apps/scale-agent
```

### 2. Instalar dependencias

```cmd
cd apps\scale-agent
npm install
```

> Si falla por `serialport`, ejecutar como Administrador y verificar
> que Visual Studio Build Tools esté instalado.

### 3. Generar íconos

```cmd
node scripts\create-placeholder-ico.js
```

Esto crea `assets\icon.ico` y `assets\tray-icon.png`.

**Para usar tu ícono de marca:**
- Reemplaza `assets\icon.ico` con tu ICO multi-tamaño (16,32,48,64,128,256px)
- Reemplaza `assets\tray-icon.png` con tu PNG de tray (16x16 o 32x32)
- Herramienta gratuita: https://convertico.com

### 4. Compilar TypeScript

```cmd
npm run build
```

Esto genera `dist\` con el código compilado.

### 5. Generar el instalador

```cmd
npm run dist
```

Esto ejecuta `electron-builder --win --x64` y genera:

```
release\
  FLUXAR Scale Agent Setup 0.1.14.exe   ← INSTALADOR
  FLUXAR Scale Agent 0.1.14.exe         ← Portable (si se usa dist:portable)
```

---

## INSTALACIÓN EN LA PC DE PRODUCCIÓN

1. Copiar `FLUXAR Scale Agent Setup 0.1.14.exe` a la PC de producción
2. Ejecutar el instalador (doble click)
3. Seguir el asistente:
   - Directorio de instalación: `C:\Program Files\FLUXAR Scale Agent\` (default)
   - Crear acceso directo en escritorio: ✅
   - Crear acceso directo en menú inicio: ✅
4. Al finalizar, el Agent se inicia automáticamente

---

## COMPORTAMIENTO POST-INSTALACIÓN

### Primera ejecución
- La app abre la ventana principal
- Si ya tiene token/enrollment previo en `%APPDATA%\fluxar-scale-agent\`,
  se conecta automáticamente sin necesidad de re-enrolar
- Si es instalación nueva, mostrar código de enrollment al administrador

### Inicio con Windows (autostart=true)
- La app arranca automáticamente al iniciar Windows
- Se inicia **oculta** (sin ventana visible) si `start_minimized=true`
- El ícono aparece en la bandeja del sistema (system tray)
- **NO aparece CMD ni terminal**

### Tray
- Click en ícono de tray → mostrar/enfocar ventana
- Click derecho → menú contextual:
  - "Abrir" → mostrar ventana
  - "Salir de FLUXAR Scale Agent" → confirmar y cerrar

### Cerrar con X
- La ventana se **oculta** (no cierra)
- El Agent sigue corriendo en background
- Las básculas siguen transmitiendo

---

## CONFIGURACIÓN PRESERVADA

La configuración se guarda en:
```
%APPDATA%\fluxar-scale-agent\
  config.json          ← api_base_url, autostart, start_minimized, devices
  token.enc            ← token cifrado con safeStorage (DPAPI en Windows)
```

Al instalar 0.1.14 sobre 0.1.13:
- La configuración existente se **preserva automáticamente**
- El token se **preserva** (mismo appId `mx.fluxar.scale-agent`)
- No es necesario re-enrolar
- COM3 y COM4 se reconectan automáticamente

---

## SOLUCIÓN DE PROBLEMAS

### "La app no arranca con Windows"
1. Abrir FLUXAR Scale Agent
2. Ir a Configuración
3. Verificar que "Iniciar con Windows" esté activado
4. Desactivar y volver a activar para re-registrar el Login Item

### "Aparece una ventana CMD al arrancar"
- Esto NO debe ocurrir con la versión instalada
- Si ocurre, verificar que se está ejecutando desde el `.exe` instalado
  y NO desde `npx electron .`

### "Error de serialport / COM no disponible"
- Verificar que el cable USB de la báscula esté conectado
- Verificar el número de puerto COM en Administrador de dispositivos
- En la app: Configuración → Dispositivos → editar puerto COM

### Logs de diagnóstico
```
%APPDATA%\fluxar-scale-agent\logs\main.log
```

---

## VERSIÓN PORTABLE (sin instalador)

```cmd
npm run dist:portable
```

Genera `release\FLUXAR Scale Agent 0.1.14.exe` — ejecutable standalone.
No requiere instalación. Doble click para ejecutar.

**Limitación:** El autostart con Windows puede no funcionar correctamente
en modo portable si el ejecutable se mueve de ubicación.

---

## NOTAS TÉCNICAS

- **Framework:** Electron 31 + Node.js embebido
- **Empaquetador:** electron-builder 24 con NSIS
- **Serialport:** addon nativo compilado para Windows x64
- **Token:** cifrado con Windows DPAPI (safeStorage de Electron)
- **Autostart:** HKCU\Software\Microsoft\Windows\CurrentVersion\Run
- **Arg --hidden:** registrado en el Login Item para inicio minimizado correcto
- **Sin CMD:** `requestedExecutionLevel: asInvoker` + Electron no abre consola
- **asar:** true — código empaquetado en archivo .asar (no editable directamente)

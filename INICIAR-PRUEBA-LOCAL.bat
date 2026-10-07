@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo FLUXAR Scale Agent - Prueba Local
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NODE_ERROR

where npm >nul 2>nul
if errorlevel 1 goto NPM_ERROR

echo Node:
node --version

echo NPM:
call npm --version

echo.

if not exist "node_modules" (
  echo Instalando dependencias...
  echo Esto puede tardar varios minutos.
  echo.
  call npm ci
  if errorlevel 1 goto INSTALL_ERROR
  echo.
  echo Dependencias instaladas correctamente.
  echo.
)

echo Iniciando FLUXAR Scale Agent...
echo La ventana de la aplicacion se abrira en unos segundos.
echo.
call npm run dev

if errorlevel 1 goto APP_ERROR
goto END

:NODE_ERROR
echo.
echo ERROR: Node.js no esta instalado o no esta disponible.
echo.
echo Instale Node.js 20 LTS desde:
echo   https://nodejs.org
echo.
echo Elija la version 20.x LTS para Windows x64.
echo Despues de instalar, cierre y vuelva a abrir esta ventana.
goto FAIL

:NPM_ERROR
echo.
echo ERROR: npm no esta disponible.
echo Reinstale Node.js 20 LTS desde https://nodejs.org
goto FAIL

:INSTALL_ERROR
echo.
echo ERROR: No fue posible instalar las dependencias.
echo.
echo Posibles causas:
echo   1. Sin conexion a internet
echo   2. serialport requiere compilacion nativa
echo      Instale Visual Studio Build Tools 2022
echo      Seleccione: Desarrollo de escritorio con C++
echo.
echo Guarde este mensaje y contacte al equipo de FLUXAR.
goto FAIL

:APP_ERROR
echo.
echo ERROR: FLUXAR Scale Agent termino con un error.
echo Revise el mensaje de error arriba.
goto FAIL

:FAIL
echo.
pause
exit /b 1

:END
endlocal

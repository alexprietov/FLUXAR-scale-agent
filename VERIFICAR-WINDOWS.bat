@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo FLUXAR Scale Agent - Verificacion
echo ========================================
echo.

set READY=YES

echo Node.js:
where node
if errorlevel 1 (
  echo   NO ENCONTRADO
  set READY=NO
) else (
  node --version
)

echo.
echo NPM:
where npm
if errorlevel 1 (
  echo   NO ENCONTRADO
  set READY=NO
) else (
  call npm --version
)

echo.
echo Arquitectura: %PROCESSOR_ARCHITECTURE%

echo.
echo Version Windows:
ver

echo.
echo Archivos del proyecto:

if exist "package.json" (
  echo   package.json         OK
) else (
  echo   package.json         FALTA
  set READY=NO
)

if exist "package-lock.json" (
  echo   package-lock.json    OK
) else (
  echo   package-lock.json    FALTA
  set READY=NO
)

if exist "src" (
  echo   src\                 OK
) else (
  echo   src\                 FALTA
  set READY=NO
)

echo.
echo ========================================
if "%READY%"=="YES" (
  echo LISTO
) else (
  echo REQUIERE ATENCION
)
echo ========================================
echo.
pause
endlocal

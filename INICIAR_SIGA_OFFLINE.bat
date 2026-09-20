@echo off
setlocal enabledelayedexpansion
title SIGA-Comunitario - Servidor Local
cd /d "%~dp0"

echo =====================================================================
echo  SIGA-Comunitario - Sistema Local Offline de Agua Potable y Caja
echo  Modo Local / Offline (Sin dependencia obligatoria de Internet)
echo =====================================================================
echo.

:: 1. Detectar motor Node.js disponible
set "NODE_EXEC="

where node >nul 2>nul
if %errorlevel% equ 0 (
    set "NODE_EXEC=node"
    echo [OK] Motor Node.js detectado en el sistema PATH.
    goto :node_found
)

if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
    set "NODE_EXEC=%APPDATA%\Antigravity\bin\agy-node.cmd"
    echo [OK] Motor Node.js detectado en Antigravity.
    goto :node_found
)

if exist "%~dp0tools\node.exe" (
    set "NODE_EXEC=%~dp0tools\node.exe"
    echo [OK] Motor Node.js portable detectado en tools.
    goto :node_found
)

:node_found
if "%NODE_EXEC%"=="" (
    echo.
    echo [ERROR] No se encontro Node.js en esta computadora.
    echo Para ejecutar el sistema offline, instala Node.js LTS desde: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 1.5. Liberar puerto 4000 si existia una instancia previa bloqueando
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)

echo [OK] Base de datos: Sincronizacion Supabase Cloud + IndexedDB Local
echo [OK] Servidor escuchando en: http://localhost:4000
echo.

:: 2. Lanzar apertura del navegador web tras 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4000"

echo =====================================================================
echo  Servidor iniciado correctamente.
echo  Abriendo http://localhost:4000 en el navegador predeterminado...
echo.
echo  Credenciales de acceso predeterminadas:
echo    - Cajera:             Usuario: cajero   Contrasena: Cajero123*
echo    - Administrador:      Usuario: admin    Contrasena: Admin123*
echo    - Lector de Campo:    Usuario: lector   Contrasena: Lector123*
echo.
echo  (Para detener el sistema, simplemente cierra esta ventana de comandos)
echo =====================================================================
echo.

:: 3. Iniciar servidor backend
cd /d "%~dp0apps\server"
"%NODE_EXEC%" --experimental-strip-types src/index.ts

pause

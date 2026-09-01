@echo off
chcp 65001 >nul
title SIGA-Comunitario • Sistema Local Offline de Agua Potable
cd /d "%~dp0"

echo =====================================================================
echo  💧 SIGA-Comunitario • Sistema Integral de Agua Potable y Caja
echo  📌 Modo 100%% Local / Offline (Sin dependencia de Internet)
echo =====================================================================
echo.

:: 1. Verificar si Node.js esta disponible
set NODE_EXEC=
where node >nul 2>nul
if %errorlevel% equ 0 (
    set NODE_EXEC=node
    echo [OK] Motor Node.js detectado en el sistema.
) else (
    if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
        set NODE_EXEC="%APPDATA%\Antigravity\bin\agy-node.cmd"
        echo [OK] Usando motor de ejecucion local.
    ) else (
        if exist "%~dp0tools\node.exe" (
            set NODE_EXEC="%~dp0tools\node.exe"
            echo [OK] Usando Node.js portable de la carpeta tools.
        )
    )
)

if "%NODE_EXEC%"=="" (
    echo.
    echo ❌ [ERROR] No se encontro Node.js en esta computadora.
    echo Para ejecutar el sistema offline, instala Node.js (incluido en la carpeta de instalacion).
    echo.
    pause
    exit /b 1
)

echo [OK] Base de datos local: SQLite (central.db)
echo [OK] Iniciando servidor en puerto 4000...
echo.

:: 2. Abrir navegador web automaticamente tras 2 segundos en segundo plano
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4000"

echo =====================================================================
echo  🚀 Sistema iniciado exitosamente!
echo  💻 Abriendo pantalla de acceso en tu navegador...
echo  🌐 Direccion local: http://localhost:4000
echo.
echo  🔑 Credenciales de la Cajera:
echo     - Usuario:    cajero
echo     - Contraseña:  Cajero123*
echo.
echo  (Manten esta ventana abierta mientras uses el sistema. Para salir, cierrala.)
echo =====================================================================
echo.

:: 3. Ejecutar servidor
cd /d "%~dp0\apps\server"
%NODE_EXEC% --experimental-strip-types src/index.ts

pause

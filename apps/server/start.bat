@echo off
title SIGA-Comunitario Backend Server
cd /d "%~dp0"

echo =====================================================================
echo  Iniciando SIGA-Comunitario Backend (Puerto 4000)
echo =====================================================================

where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Usando Node.js global del sistema...
    node --experimental-strip-types src/index.ts
    goto end
)

if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
    echo [OK] Usando Runtime Node v24 de Antigravity...
    "%APPDATA%\Antigravity\bin\agy-node.cmd" --experimental-strip-types src/index.ts
    goto end
)

echo [ERROR] No se encontro Node.js instalado en el sistema.
echo Por favor instala Node.js LTS desde: https://nodejs.org
pause

:end

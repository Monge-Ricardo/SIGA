# Script de arranque en PowerShell para SIGA-Comunitario Backend
$serverDir = Join-Path $PSScriptRoot "apps\server"
if (-not (Test-Path $serverDir)) {
    $serverDir = $PSScriptRoot
}
Set-Location $serverDir

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " Iniciando SIGA-Comunitario Backend (Puerto 4000)                    " -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan

$agyNode = "$env:APPDATA\Antigravity\bin\agy-node.cmd"

if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Usando Node.js global del sistema..." -ForegroundColor Green
    node --experimental-strip-types src/index.ts
} elseif (Test-Path $agyNode) {
    Write-Host "[OK] Usando Runtime Node v24 integrado en Antigravity..." -ForegroundColor Green
    & $agyNode --experimental-strip-types src/index.ts
} else {
    Write-Host "[ERROR] Node.js no esta disponible en el PATH." -ForegroundColor Red
    Write-Host "Instala Node.js LTS (v22/v24) desde: https://nodejs.org" -ForegroundColor Yellow
}

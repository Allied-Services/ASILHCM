# Non-interactive Fixed Value / PSO North Zone staging ops.
# Usage (from repo root):
#   powershell -File scripts/run_staging_fv_ops.ps1
# Loads DATABASE_URL from (first found):
#   1) existing $env:DATABASE_URL / $env:STAGING_DATABASE_URL
#   2) backend/.env.local or backend/.env (STAGING_DATABASE_URL or DATABASE_URL)
#   3) Cursor project staging-env-import.env
# Refuses to run if host is not the Neon staging branch ep-weathered-mode-adotvvct.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Import-EnvFile([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    Get-Content $Path | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
        $k, $v = $_.Split('=', 2)
        $k = $k.Trim(); $v = $v.Trim().Trim('"').Trim("'")
        if (-not [Environment]::GetEnvironmentVariable($k)) {
            Set-Item -Path "Env:$k" -Value $v
        }
    }
}

if (-not $env:DATABASE_URL -and $env:STAGING_DATABASE_URL) {
    $env:DATABASE_URL = $env:STAGING_DATABASE_URL
}

@(
    (Join-Path $Root 'backend\.env.local'),
    (Join-Path $Root 'backend\.env'),
    (Join-Path $env:USERPROFILE '.cursor\projects\g-My-Drive-Experiments-BPOFMSystem\staging-env-import.env')
) | ForEach-Object { Import-EnvFile $_ }

if (-not $env:DATABASE_URL -and $env:STAGING_DATABASE_URL) {
    $env:DATABASE_URL = $env:STAGING_DATABASE_URL
}

if (-not $env:DATABASE_URL) {
    Write-Error 'DATABASE_URL / STAGING_DATABASE_URL not found. Set it or add staging-env-import.env.'
}

if ($env:DATABASE_URL -notmatch 'ep-weathered-mode-adotvvct') {
    Write-Error 'Refusing to run: DATABASE_URL host is not Neon staging (ep-weathered-mode-adotvvct).'
}

Write-Host '== migrate =='
Push-Location (Join-Path $Root 'backend')
npm run migrate
if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
Pop-Location

Write-Host '== seed PSO North Zone =='
node (Join-Path $Root 'scripts\seed_pso_north_zone.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '== Tarujabba Mar invoice smoke =='
node (Join-Path $Root 'scripts\_smoke_tarujabba_invoice.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'OK: migrate + seed + Tarujabba grand=2479745'
exit 0

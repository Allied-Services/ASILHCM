# Regenerate database/schema.sql from live Postgres (schema-only pg_dump).
# Usage: set DATABASE_URL to prod (or branch to snapshot), then:
#   .\scripts\regen_schema.ps1

$ErrorActionPreference = 'Stop'

if (-not $env:DATABASE_URL) {
    Write-Error 'DATABASE_URL is not set. Point it at the database branch to snapshot (typically prod after migration deploy).'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$outFile = Join-Path $repoRoot 'database\schema.sql'
$pgDump = if ($env:PG_DUMP_BIN) { $env:PG_DUMP_BIN } else { 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' }

if (-not (Test-Path $pgDump)) {
    Write-Error "pg_dump not found at: $pgDump. Set PG_DUMP_BIN or install PostgreSQL client tools."
}

$header = @"
-- GENERATED from production via pg_dump --schema-only. DO NOT HAND-EDIT.
-- Regenerate after every migration deploy: see scripts/regen_schema.ps1
-- Generated: $(Get-Date -Format 'yyyy-MM-dd')

"@

$tmp = [System.IO.Path]::GetTempFileName()
try {
    & $pgDump --schema-only --no-owner --no-privileges $env:DATABASE_URL | Set-Content -Path $tmp -Encoding utf8
    Set-Content -Path $outFile -Value $header -Encoding utf8
    Get-Content $tmp | Add-Content -Path $outFile -Encoding utf8
    Write-Host "Wrote $outFile ($((Get-Item $outFile).Length) bytes)"
}
finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
}

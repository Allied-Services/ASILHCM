# ASIL HCM — Production database backup (S0A)
# Re-run before every risky remediation phase and every cutover month.
# Requires: $env:DATABASE_URL set to the production Neon connection string.
# Requires: pg_dump on PATH (PostgreSQL client tools).

$ErrorActionPreference = 'Stop'

if (-not $env:DATABASE_URL) {
    Write-Error 'DATABASE_URL is not set. Export the production Neon URL before running this script.'
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    $defaultPgDump = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
    if (Test-Path $defaultPgDump) {
        $pgDump = $defaultPgDump
    } else {
        Write-Error 'pg_dump not found. Install PostgreSQL client tools or add pg_dump to PATH.'
    }
} else {
    $pgDump = $pgDump.Source
}

$backupsDir = Join-Path (Join-Path $PSScriptRoot '..') 'backups'
if (-not (Test-Path $backupsDir)) {
    New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
}
$backupsDir = (Resolve-Path $backupsDir).Path

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outFile = Join-Path $backupsDir "prod_$timestamp.dump"

Write-Host "Backing up production to $outFile ..."
& $pgDump -Fc -d $env:DATABASE_URL -f $outFile

if (-not (Test-Path $outFile)) {
    Write-Error ('Backup failed - output file not created: ' + $outFile)
}

$sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host ('Backup complete: {0} ({1} megabytes)' -f $outFile, $sizeMb)

if ($sizeMb -lt 1) {
    Write-Warning 'Backup file is under 1 MB - verify DATABASE_URL points at production.'
}

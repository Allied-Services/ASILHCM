# =============================================================================
# npm-install-safe.ps1
# Safe npm installer for Google Drive Stream environments
#
# USAGE:
#   From backend\ directory:
#     powershell -ExecutionPolicy Bypass -File npm-install-safe.ps1
#
#   With custom packages:
#     powershell -ExecutionPolicy Bypass -File npm-install-safe.ps1 -Packages "lodash axios"
#
# HOW IT WORKS:
#   1. Temporarily stops Google Drive to release all file-handle locks
#   2. Runs npm install (Drive not running = no EBADF / EPERM errors)
#   3. Restarts Google Drive automatically when done
# =============================================================================

param(
    [string]$Packages = "",
    [string]$WorkDir  = $PSScriptRoot
)

$drivePaths = @(
    "C:\Program Files\Google\DriveFS\GoogleDriveFS.exe",
    "C:\Program Files\Google\Drive File Stream\GoogleDriveFS.exe"
)

# ── Locate Drive executable ───────────────────────────────────────────────────
$driveExe = $drivePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

# ── Stop Drive ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [1/3] Pausing Google Drive..." -ForegroundColor Cyan
$driveWasRunning = $false

$driveProcess = Get-Process -Name "GoogleDriveFS" -ErrorAction SilentlyContinue
if ($driveProcess) {
    $driveWasRunning = $true
    Stop-Process -Name "GoogleDriveFS" -Force
    Start-Sleep -Seconds 3
    Write-Host "        Drive stopped." -ForegroundColor Green
} else {
    Write-Host "        Drive was not running — proceeding." -ForegroundColor Yellow
}

# ── Run npm install ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [2/3] Running npm install..." -ForegroundColor Cyan
Set-Location $WorkDir

if ($Packages -ne "") {
    Write-Host "        Installing: $Packages"
    $cmd = "npm install $Packages --no-fund"
} else {
    Write-Host "        Installing all dependencies from package.json"
    $cmd = "npm install --no-fund"
}

Invoke-Expression $cmd
$npmExitCode = $LASTEXITCODE

# ── Restart Drive ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [3/3] Restarting Google Drive..." -ForegroundColor Cyan
if ($driveWasRunning -and $driveExe) {
    Start-Process $driveExe
    Write-Host "        Drive restarted." -ForegroundColor Green
} elseif ($driveWasRunning -and -not $driveExe) {
    Write-Host "        Could not find Drive executable to restart." -ForegroundColor Yellow
    Write-Host "        Please restart Google Drive manually from the Start Menu." -ForegroundColor Yellow
} else {
    Write-Host "        Drive was not running before — leaving it stopped." -ForegroundColor Yellow
}

# ── Result ────────────────────────────────────────────────────────────────────
Write-Host ""
if ($npmExitCode -eq 0) {
    Write-Host "  SUCCESS — npm install completed cleanly." -ForegroundColor Green
} else {
    Write-Host "  WARNING — npm exited with code $npmExitCode. Check output above." -ForegroundColor Red
}
Write-Host ""

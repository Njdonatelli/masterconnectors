# install-vpk-tool.ps1
# ----------------------------------------------------------------------
# One-shot installer / upgrader for the Velopack `vpk` .NET global tool.
#
# Pinned major version: 0.0.* (Velopack ships under 0.0.x preview series).
# Bump the version range deliberately when upgrading; do not let CI silently
# pull a newer major.
#
# Prerequisite: .NET 8 SDK (or newer) on PATH.
# ----------------------------------------------------------------------

$ErrorActionPreference = "Stop"

# vpk 0.0.1298 targets net9.0; allow running on any newer .NET runtime
# (e.g. net10). Set before any vpk invocation.
$env:DOTNET_ROLL_FORWARD = "Major"

# Verify dotnet is available before attempting tool install -- gives a clear
# error message instead of an opaque "command not found".
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    throw "dotnet SDK not found on PATH. Install .NET 8 SDK from https://dot.net/download"
}

Write-Host "Installing/upgrading vpk global tool..." -ForegroundColor Cyan

# Try install first; if already installed, fall back to update.
& dotnet tool install --global vpk --version "0.0.*" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "vpk already installed -- running update instead." -ForegroundColor Yellow
    & dotnet tool update --global vpk --version "0.0.*"
    if ($LASTEXITCODE -ne 0) { throw "vpk install/update failed" }
}

# Verify the binary is on PATH (dotnet global tools live in %USERPROFILE%\.dotnet\tools)
$vpk = Get-Command vpk -ErrorAction SilentlyContinue
if (-not $vpk) {
    throw "vpk installed but not on PATH. Add %USERPROFILE%\.dotnet\tools to PATH and re-run."
}

# vpk has no --version flag; the first line of --help contains the version.
$help = & vpk --help 2>&1
$verLine = $help | Select-String -Pattern "Velopack CLI" | Select-Object -First 1
if ($verLine) {
    Write-Host "vpk: $verLine" -ForegroundColor Green
} else {
    Write-Host "vpk installed (version line not parsed, but tool runs)" -ForegroundColor Yellow
}

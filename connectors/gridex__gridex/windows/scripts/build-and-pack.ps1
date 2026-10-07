# build-and-pack.ps1
# ----------------------------------------------------------------------
# One-command orchestrator: install vpk -> build unpackaged -> pack release.
#
# Usage:
#   .\windows\scripts\build-and-pack.ps1                    # uses 0.0.1-dev
#   .\windows\scripts\build-and-pack.ps1 -Version 1.0.0
#   .\windows\scripts\build-and-pack.ps1 -Version 1.0.0 -Channel beta
#
# Outputs to: E:\dev\be\vura\windows\Releases\
# ----------------------------------------------------------------------

param(
    [string]$Version = "0.0.1-dev",
    [string]$Channel = "stable"
)

$ErrorActionPreference = "Stop"
$start = Get-Date

Write-Host "==> install vpk tool" -ForegroundColor Magenta
& "$PSScriptRoot\install-vpk-tool.ps1"

Write-Host "==> build unpackaged" -ForegroundColor Magenta
# Forward -Version so GridexVersion.generated.h is stamped before compile.
# Without this the About section inside Gridex.exe stays "0.0.0-dev" while
# Velopack metadata/Setup.exe report the passed version -- confusing mismatch.
& "$PSScriptRoot\build-unpackaged.ps1" -Version $Version

Write-Host "==> pack velopack release" -ForegroundColor Magenta
& "$PSScriptRoot\pack-velopack.ps1" -Version $Version -Channel $Channel

$elapsed = (Get-Date) - $start
Write-Host ""
Write-Host "Done in $([math]::Round($elapsed.TotalSeconds, 1))s. Artifacts at windows\Releases\" -ForegroundColor Green

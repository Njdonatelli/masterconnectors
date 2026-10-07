# pack-velopack.ps1
# ----------------------------------------------------------------------
# Wrap `vpk pack` to produce Setup.exe + nupkg + delta + RELEASES manifest
# from the unpackaged MSBuild output.
#
# Requires: install-vpk-tool.ps1 to have run successfully (vpk on PATH).
# Requires: build-unpackaged.ps1 to have run successfully (output present).
#
# Output (default): E:\dev\be\vura\windows\Releases\
#   - Setup.exe                       (user-facing installer)
#   - Gridex-<ver>-full.nupkg         (full package)
#   - Gridex-<ver>-delta.nupkg        (only present from v2 onward)
#   - releases.stable.json            (auto-update feed manifest)
#   - RELEASES                        (legacy feed file)
#
# ----------------------------------------------------------------------
# Feed manifest schemas (captured from a real `vpk pack` run, vpk v0.0.1298,
# with channel=stable, version=0.0.1-dev):
#
# releases.stable.json -- legacy JSON feed used by Velopack update clients:
#   {
#     "Assets": [
#       {
#         "PackageId": "Gridex",
#         "Version":   "0.0.1-dev",
#         "Type":      "Full" | "Delta",
#         "FileName":  "Gridex-0.0.1-dev-stable-full.nupkg",
#         "SHA1":      "<40-hex>",
#         "SHA256":    "<64-hex>",
#         "Size":      <bytes>
#       }
#     ]
#   }
#
# assets.stable.json -- new JSON feed listing all release artifacts:
#   [
#     {"RelativeFileName": "Gridex-stable-Setup.exe",             "Type": "Installer"},
#     {"RelativeFileName": "Gridex-0.0.1-dev-stable-full.nupkg",  "Type": "Full"},
#     {"RelativeFileName": "Gridex-stable-Portable.zip",          "Type": "Portable"}
#   ]
#
# RELEASES-stable -- legacy text feed, one line per nupkg:
#   <SHA1> <filename.nupkg> <size-bytes>
# ----------------------------------------------------------------------

param(
    [Parameter(Mandatory=$true)][string]$Version,
    [string]$Channel   = "stable",
    # MSBuild puts the full unpackaged output (with all WinAppSDK runtime
    # DLLs) under the project-nested path, NOT $(SolutionDir)\x64.
    [string]$PackDir   = "windows\Gridex\x64\Release\Gridex",
    [string]$OutputDir = "windows\Releases"
)

$ErrorActionPreference = "Stop"

# vpk 0.0.1298 targets net9.0; allow running on any newer .NET runtime.
$env:DOTNET_ROLL_FORWARD = "Major"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# vpk's --packDir / --outputDir resolve relative to CWD; pin CWD to repo root
# so callers can pass repo-relative paths regardless of where they invoked us.
Push-Location $repoRoot
try {
    $absPack = Join-Path $repoRoot $PackDir
    if (-not (Test-Path $absPack)) {
        throw "Pack source dir not found: $absPack (run build-unpackaged.ps1 first)"
    }

    # Ensure the main exe really exists in the pack dir -- vpk would fail
    # later with a less obvious error.
    $mainExe = Join-Path $absPack "Gridex.exe"
    if (-not (Test-Path $mainExe)) {
        throw "Gridex.exe missing from pack dir: $mainExe"
    }

    Write-Host "Packing Velopack release v$Version (channel=$Channel)..." -ForegroundColor Cyan

    # Velopack Setup.exe icon -- use the same Gridex.ico that gets
    # embedded into Gridex.exe via the .rc file. Path is resolved from
    # the pinned CWD ($repoRoot above).
    $iconPath = "windows\Gridex\Assets\Gridex.ico"
    if (-not (Test-Path $iconPath)) {
        Write-Warning "Setup icon missing at $iconPath -- Velopack will use its default phoenix icon"
        $iconPath = $null
    }

    $vpkArgs = @(
        'pack',
        '--packId', 'Gridex',
        '--packVersion', $Version,
        '--packDir', $PackDir,
        '--mainExe', 'Gridex.exe',
        '--channel', $Channel,
        '--outputDir', $OutputDir
    )
    if ($iconPath) {
        $vpkArgs += @('--icon', $iconPath)
    }

    & vpk @vpkArgs

    if ($LASTEXITCODE -ne 0) {
        throw "vpk pack failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

# Sanity-check the artifacts landed where expected.
#
# Velopack naming convention (observed with vpk 0.0.1298):
#   Gridex-<channel>-Setup.exe            (installer)
#   Gridex-<version>-<channel>-full.nupkg (full package)
#   Gridex-<channel>-Portable.zip         (portable bonus)
#   releases.<channel>.json               (legacy feed manifest)
#   assets.<channel>.json                 (new feed manifest)
#   RELEASES-<channel>                    (legacy text feed)
#
$absOut = Join-Path $repoRoot $OutputDir
$expected = @(
    "Gridex-$Channel-Setup.exe",
    "Gridex-$Version-$Channel-full.nupkg",
    "releases.$Channel.json",
    "RELEASES-$Channel"
)
foreach ($f in $expected) {
    $p = Join-Path $absOut $f
    if (-not (Test-Path $p)) {
        Write-Warning "Expected artifact missing: $p"
    } else {
        $size = [math]::Round((Get-Item $p).Length / 1MB, 2)
        Write-Host "  [OK] $f ($size MB)" -ForegroundColor Green
    }
}

Write-Host "Artifacts: $absOut" -ForegroundColor Green

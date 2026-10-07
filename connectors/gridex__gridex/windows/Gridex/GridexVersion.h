#pragma once
//
// Gridex version string shown in the About section of SettingsPage.
//
// The actual value lives in `GridexVersion.generated.h`, which is
// (always) written by `windows\scripts\build-unpackaged.ps1` before
// MSBuild runs. The CI workflow (.github/workflows/windows-release.yml)
// passes `-Version <tag>`; local dev builds run without it and get the
// "0.0.0-dev" sentinel so it is obvious the binary is not a tagged
// release.
//
// Why an UNCONDITIONAL include (no __has_include): MSBuild incremental
// builds use the per-file `.tlog` to decide whether a translation unit
// must be recompiled. `.tlog` only records headers that were actually
// pulled in during the last compile, so a conditional include via
// __has_include is invisible to the dependency scanner. That meant
// switching the script between `-Version` and no-Version runs left
// SettingsPage.obj stale -- the UI kept showing the old version. The
// build script now ALWAYS writes the generated header (default value
// `0.0.0-dev`), making the dependency real and the incremental build
// reliable.
//
#include "GridexVersion.generated.h"

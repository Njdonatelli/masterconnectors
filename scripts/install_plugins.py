#!/usr/bin/env python3
"""Install masterconnectors into Antigravity CLI and Claude Code.

    python scripts/install_plugins.py
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN_PATH = ROOT / "plugins" / "masterconnectors"

def run(cmd: list[str]) -> int:
    print("$", " ".join(cmd))
    res = subprocess.run(cmd)
    return res.returncode

def main() -> int:
    agy = shutil.which("agy")
    claude = shutil.which("claude")

    if agy:
        print("=== Installing into Antigravity CLI (agy) ===")
        run([agy, "plugin", "validate", str(PLUGIN_PATH)])
        run([agy, "plugin", "install", str(PLUGIN_PATH)])

    if claude:
        print("=== Installing into Claude Code ===")
        run([claude, "plugin", "validate", str(PLUGIN_PATH)])
        run([claude, "plugin", "marketplace", "add", str(ROOT)])
        run([claude, "plugin", "install", "masterconnectors@masterconnectors"])

    print("=== MasterConnectors Installation Complete ===")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

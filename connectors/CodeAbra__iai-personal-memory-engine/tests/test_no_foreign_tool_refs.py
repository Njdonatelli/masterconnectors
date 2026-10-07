"""Guard: the public tree must not reference external or private-workflow tooling.

Contributor tooling, hooks, comments, and docstrings ship to end users. Names of
third-party code-search tools or local developer hooks must never appear in the
tracked tree. Forbidden tokens are assembled from fragments so this guard does
not match itself; the guard file is also excluded from the scan by name.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]

_HYPHEN = "context" + "-" + "mode"
_UNDER = "context" + "_" + "mode"
_JOINED = "context" + "mode"
_NO_GREP = "no" + "-" + "grep"
_CTX_TOOLS = tuple(
    "ctx_" + name
    for name in (
        "search",
        "execute",
        "execute_file",
        "batch_execute",
        "index",
        "fetch_and_index",
        "stats",
        "doctor",
        "purge",
        "upgrade",
        "insight",
    )
)
_FORBIDDEN = (_HYPHEN, _UNDER, _JOINED, _NO_GREP) + _CTX_TOOLS

_BINARY_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".pdf",
    ".so", ".dylib", ".dll", ".whl", ".zip", ".gz", ".tar",
    ".woff", ".woff2", ".ttf", ".otf", ".pyc",
)


def _tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line]


def test_tree_has_no_foreign_or_private_tool_references() -> None:
    files = _tracked_files()
    if not files:
        pytest.skip("not a git checkout; nothing to scan")

    this_file = Path(__file__).name
    hits: list[str] = []
    for rel in files:
        if Path(rel).name == this_file:
            continue
        if rel.lower().endswith(_BINARY_SUFFIXES):
            continue
        path = REPO_ROOT / rel
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lowered = text.lower()
        for token in _FORBIDDEN:
            if token in lowered:
                for i, line in enumerate(text.splitlines(), 1):
                    if token in line.lower():
                        hits.append(f"{rel}:{i}: {token!r}")
                        break

    assert not hits, (
        "External/private tooling references must not ship in the public tree:\n"
        + "\n".join(hits)
    )

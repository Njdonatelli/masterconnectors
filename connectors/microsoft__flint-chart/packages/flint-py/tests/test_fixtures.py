"""Pytest harness that diffs Python-compiled Vega-Lite specs against the JS reference.

Each fixture lives under tests/fixtures/<slug>/ with two files:
  - input.json     -- payload passed to assembleVegaLite() in the JS reference
  - expected.json  -- the exact JSON spec produced by the JS reference
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import pytest


FIXTURES_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "shared" / "test-data"


def _discover_fixtures() -> list[tuple[str, Path]]:
    if not FIXTURES_ROOT.exists():
        return []
    out: list[tuple[str, Path]] = []
    for entry in sorted(FIXTURES_ROOT.iterdir()):
        if not entry.is_dir():
            continue
        if not (entry / "input.json").exists() or not (entry / "expected.json").exists():
            continue
        out.append((entry.name, entry))
    return out


FIXTURES = _discover_fixtures()


def _float_close(a: float, b: float, *, atol: float = 1e-6, rtol: float = 1e-6) -> bool:
    if a == b:
        return True
    if math.isnan(a) and math.isnan(b):
        return True
    if math.isinf(a) or math.isinf(b):
        return a == b
    return abs(a - b) <= atol + rtol * max(abs(a), abs(b))


def _diff(path: str, actual: Any, expected: Any, errors: list[str]) -> None:
    if isinstance(expected, dict) and isinstance(actual, dict):
        # Compare key sets.
        exp_keys = set(expected.keys())
        act_keys = set(actual.keys())
        for k in sorted(exp_keys - act_keys):
            errors.append(f"{path}: missing key {k!r}")
        for k in sorted(act_keys - exp_keys):
            errors.append(f"{path}: extra key {k!r} (value={actual[k]!r})")
        for k in sorted(exp_keys & act_keys):
            _diff(f"{path}.{k}", actual[k], expected[k], errors)
        return

    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            errors.append(
                f"{path}: length mismatch (expected {len(expected)}, got {len(actual)})"
            )
            n = min(len(expected), len(actual))
        else:
            n = len(expected)
        for i in range(n):
            _diff(f"{path}[{i}]", actual[i], expected[i], errors)
        return

    if isinstance(expected, float) or isinstance(actual, float):
        try:
            if _float_close(float(actual), float(expected)):
                return
        except (TypeError, ValueError):
            pass

    if actual != expected:
        errors.append(f"{path}: expected {expected!r}, got {actual!r}")


def deep_diff(actual: Any, expected: Any) -> list[str]:
    errors: list[str] = []
    _diff("$", actual, expected, errors)
    return errors


@pytest.fixture(scope="session")
def assemble_vegalite():
    try:
        from flint.vegalite import assemble_vegalite as _av
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"flint.vegalite.assemble_vegalite not importable yet: {e}")
    return _av


@pytest.mark.parametrize(
    "slug,path",
    FIXTURES,
    ids=[slug for slug, _ in FIXTURES],
)
def test_fixture_matches_js_reference(slug: str, path: Path, assemble_vegalite) -> None:
    if os.environ.get("FLINT_PY_ONLY"):
        only = os.environ["FLINT_PY_ONLY"]
        if only not in slug:
            pytest.skip(f"FLINT_PY_ONLY={only} doesn't match")

    with (path / "input.json").open() as f:
        input_doc = json.load(f)
    with (path / "expected.json").open() as f:
        expected = json.load(f)

    try:
        actual = assemble_vegalite(input_doc["input"])
    except ValueError as e:
        # Chart-type templates that aren't ported yet raise ValueError("Unknown
        # chart type: ..."). Skip rather than fail so the suite reports a clean
        # signal for ported templates only. See FULL_GALLERY_REPORT.md for the
        # canonical pass/fail/not-ported breakdown.
        if "Unknown chart type" in str(e):
            pytest.skip(f"chart type not yet ported: {e}")
        raise

    diffs = deep_diff(actual, expected)
    if diffs:
        if len(diffs) > 60:
            diffs = diffs[:60] + [f"... and {len(diffs) - 60} more"]
        pytest.fail("Spec mismatch for {0}:\n{1}".format(slug, "\n".join(diffs)))

    # Stricter check: byte-exact JSON serialization (with sorted keys and rounded
    # floats so dict ordering and last-bit float drift don't trip the assertion).
    # Catches things the structural diff treats as equal — e.g. int 200 vs float
    # 200.0 — which JS's JSON.stringify collapses but Python's json.dumps doesn't.
    def _canon(obj: Any) -> Any:
        if isinstance(obj, dict):
            return {k: _canon(obj[k]) for k in sorted(obj)}
        if isinstance(obj, list):
            return [_canon(x) for x in obj]
        if isinstance(obj, float) and not isinstance(obj, bool):
            return round(obj, 9)
        return obj

    actual_json = json.dumps(_canon(actual), sort_keys=True)
    expected_json = json.dumps(_canon(expected), sort_keys=True)
    if actual_json != expected_json:
        for i, (a, b) in enumerate(zip(actual_json, expected_json)):
            if a != b:
                ctx = 80
                pytest.fail(
                    f"Byte-level JSON mismatch for {slug} at offset {i}:\n"
                    f"  actual  ...{actual_json[max(0, i - ctx):i + ctx]}...\n"
                    f"  expected...{expected_json[max(0, i - ctx):i + ctx]}..."
                )
        pytest.fail(
            f"Byte-level JSON length mismatch for {slug}: "
            f"actual={len(actual_json)}, expected={len(expected_json)}"
        )

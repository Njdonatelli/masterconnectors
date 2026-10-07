"""Build a static results page bundling every Python-compiled spec.

Produces three files under ``flint-py/tools/viewer/``:

* ``results.js`` — a single ``window.FLINT_RESULTS`` array containing
  ``{slug, title, chartType, section, page, status, spec, error}``
  records for every gallery fixture.
* ``index.html`` — a self-contained viewer that loads ``results.js``
  and renders an image-wall of cards (chart + collapsible spec JSON).
* ``styles.css`` — viewer styling.

The page is fully static — open ``index.html`` directly in a browser.

Usage::

    python flint-py/tools/build_results_page.py
"""

from __future__ import annotations

import json
import math
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
OUT_DIR = Path(__file__).resolve().parent / "viewer"

sys.path.insert(0, str(ROOT))
from flint.vegalite import assemble_vegalite  # noqa: E402


def _sanitise(obj):
    """Strip non-JSON-serialisable floats (NaN / +-Inf) — match JS JSON.stringify."""
    if isinstance(obj, dict):
        return {k: _sanitise(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitise(v) for v in obj]
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    return obj


def main() -> int:
    manifest_path = FIXTURES / "manifest.json"
    if not manifest_path.exists():
        print("ERROR: manifest.json not found — run the vitest extractor first.", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text())

    records: list[dict] = []
    n_pass = n_err = n_skip = 0
    for entry in manifest:
        slug = entry["slug"]
        rec = {
            "slug": slug,
            "title": entry.get("title") or slug,
            "chartType": entry.get("chartType") or "",
            "section": entry.get("section") or "",
            "category": entry.get("category") or "",
            "page": entry.get("page") or "",
            "generator": entry.get("generator") or "",
            "status": "ok",
            "spec": None,
            "error": None,
        }

        dir_ = FIXTURES / slug
        input_path = dir_ / "input.json"
        if not input_path.exists():
            rec["status"] = "no_input"
            rec["error"] = "missing input.json"
            n_skip += 1
            records.append(rec)
            continue

        try:
            doc = json.loads(input_path.read_text())
        except Exception as exc:
            rec["status"] = "no_input"
            rec["error"] = f"{type(exc).__name__}: {exc}"
            n_skip += 1
            records.append(rec)
            continue

        try:
            actual = assemble_vegalite(doc["input"])
        except Exception as exc:
            rec["status"] = "py_error"
            rec["error"] = f"{type(exc).__name__}: {exc}"
            rec["traceback"] = traceback.format_exc(limit=2)
            n_err += 1
            records.append(rec)
            continue

        rec["spec"] = _sanitise(actual)
        n_pass += 1
        records.append(rec)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "results.js").write_text(
        "window.FLINT_RESULTS = " + json.dumps(records, separators=(",", ":")) + ";\n"
    )

    print(f"Wrote {OUT_DIR / 'results.js'}")
    print(f"Records: {len(records)}  (ok={n_pass}  py_error={n_err}  skipped={n_skip})")
    print(f"Open {OUT_DIR / 'index.html'} in a browser.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

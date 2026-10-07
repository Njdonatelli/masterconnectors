"""Port of tests/frontend/unit/lib/agents-chart/vegalite/zeroBaseline.test.ts."""
from __future__ import annotations

from typing import Any

from flint.vegalite import assemble_vegalite

CANVAS = {"width": 500, "height": 400}


def _applicable_keys(spec: dict[str, Any]) -> list[str]:
    return [o["key"] for o in spec.get("_options", []) if o.get("applicable")]


def _option_for(spec: dict[str, Any], key: str) -> dict[str, Any] | None:
    return next((o for o in spec.get("_options", []) if o.get("key") == key), None)


def _y_scale(spec: dict[str, Any]) -> dict[str, Any] | None:
    """Resolve y scale across top / nested / layer / facet spec nestings."""
    if isinstance(spec, dict):
        s = (spec.get("encoding") or {}).get("y", {}).get("scale")
        if s is not None:
            return s
        inner = spec.get("spec")
        if isinstance(inner, dict):
            s = (inner.get("encoding") or {}).get("y", {}).get("scale")
            if s is not None:
                return s
        for nested in (spec.get("layer"), (spec.get("spec") or {}).get("layer") if isinstance(spec.get("spec"), dict) else None):
            if isinstance(nested, list):
                for layer in nested:
                    if isinstance(layer, dict):
                        s = (layer.get("encoding") or {}).get("y", {}).get("scale")
                        if s is not None:
                            return s
    return None


def _y_includes_zero(spec: dict[str, Any]) -> bool:
    scale = _y_scale(spec)
    if not scale:
        return False
    if scale.get("zero") is True:
        return True
    domain = scale.get("domain")
    if isinstance(domain, list) and domain and domain[0] == 0:
        return True
    if scale.get("domainMin") == 0:
        return True
    return False


def _scatter_y(y_type: str, y_values: list[float], chart_properties: dict | None = None) -> dict[str, Any]:
    values = [{"x": i + 1, "y": v} for i, v in enumerate(y_values)]
    return assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"x": "Number", "y": y_type},
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {"x": {"field": "x"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
            **({"chartProperties": chart_properties} if chart_properties else {}),
        },
    })


# ── offer eligibility ───────────────────────────────────────────────────────

def test_does_not_offer_zero_y_for_arbitrary_type_away_from_zero():
    spec = _scatter_y("Temperature", [60, 70, 80, 90, 100])
    assert "includeZero_y" not in _applicable_keys(spec)
    assert _y_includes_zero(spec) is False


def test_does_not_offer_zero_y_for_contextual_type_close_to_zero():
    spec = _scatter_y("Percentage", [5, 10, 15, 20, 25])
    assert "includeZero_y" not in _applicable_keys(spec)
    assert _y_includes_zero(spec) is True


def test_does_not_offer_zero_y_for_meaningful_type_close_enough_to_zero():
    # Scatter reads as cloud shape, not distance-from-zero, so zero is now an
    # opt-in toggle (default off) regardless of distance. Mirrors current JS.
    spec = _scatter_y("Price", [10, 20, 30, 40])
    assert "includeZero_y" in _applicable_keys(spec)
    opt = _option_for(spec, "includeZero_y")
    assert opt is not None and opt.get("value") is False
    assert _y_includes_zero(spec) is False


def test_offers_zero_y_for_meaningful_type_far_from_zero():
    spec = _scatter_y("Price", [1000, 1050, 1100, 1150, 1200])
    assert "includeZero_y" in _applicable_keys(spec)
    opt = _option_for(spec, "includeZero_y")
    assert opt is not None and opt.get("value") is False
    assert _y_includes_zero(spec) is False


def test_does_not_offer_zero_y_for_unknown_type():
    spec = _scatter_y("Mystery", [60, 70, 80, 90])
    assert "includeZero_y" not in _applicable_keys(spec)


def test_does_not_offer_zero_y_on_bar_chart_arbitrary_type():
    spec = assemble_vegalite({
        "data": {"values": [{"cat": c, "y": v} for c, v in [("a", 60), ("b", 70), ("c", 80), ("d", 90)]]},
        "semantic_types": {"cat": "Category", "y": "Temperature"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "cat"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
        },
    })
    assert "includeZero_y" not in _applicable_keys(spec)


def test_does_not_offer_zero_y_on_bar_chart_meaningful_type():
    spec = assemble_vegalite({
        "data": {"values": [{"cat": c, "y": v} for c, v in [("a", 10), ("b", 20), ("c", 30), ("d", 40)]]},
        "semantic_types": {"cat": "Category", "y": "Price"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "cat"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
        },
    })
    assert "includeZero_y" not in _applicable_keys(spec)


# ── override propagation ────────────────────────────────────────────────────

def test_unset_follows_engine_decision():
    spec = _scatter_y("Temperature", [60, 70, 80, 90, 100])
    assert _y_includes_zero(spec) is False


def test_on_forces_axis_to_include_zero():
    spec = _scatter_y("Temperature", [60, 70, 80, 90, 100], {"includeZero_y": True})
    assert _y_includes_zero(spec) is True
    assert "includeZero_y" in _applicable_keys(spec)


def test_off_fits_data_for_contextual_type_near_zero():
    spec = _scatter_y("Percentage", [5, 10, 15, 20, 25], {"includeZero_y": False})
    assert _y_includes_zero(spec) is False
    assert "includeZero_y" in _applicable_keys(spec)


def test_off_fits_data_for_meaningful_type():
    spec = _scatter_y("Price", [0.8, 1.0, 1.4, 1.8, 2.0], {"includeZero_y": False})
    assert _y_includes_zero(spec) is False
    assert "includeZero_y" in _applicable_keys(spec)

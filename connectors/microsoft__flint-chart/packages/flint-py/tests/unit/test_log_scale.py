"""Port of tests/frontend/unit/lib/agents-chart/vegalite/logScale.test.ts."""
from __future__ import annotations

from typing import Any

from flint.vegalite import assemble_vegalite, get_chart_options

CANVAS = {"width": 500, "height": 400}

WIDE_X = [{"x": 10 ** (i * 0.7), "y": i + 1} for i in range(12)]


def _applicable_keys(spec: dict[str, Any]) -> list[str]:
    return [o["key"] for o in spec.get("_options", []) if o.get("applicable")]


def _option_for(spec: dict[str, Any], key: str) -> dict[str, Any] | None:
    return next((o for o in spec.get("_options", []) if o.get("key") == key), None)


def _scatter(encodings: dict[str, Any], chart_properties: dict | None = None) -> dict[str, Any]:
    cs = {
        "chartType": "Scatter Plot",
        "encodings": encodings,
        "baseSize": CANVAS,
    }
    if chart_properties:
        cs["chartProperties"] = chart_properties
    return assemble_vegalite({
        "data": {"values": WIDE_X},
        "semantic_types": {"x": "Quantity", "y": "Number"},
        "chart_spec": cs,
    })


def test_offers_log_x_on_wide_range_axis():
    spec = _scatter({"x": {"field": "x"}, "y": {"field": "y"}})
    assert "logScale_x" in _applicable_keys(spec)


def test_does_not_offer_log_on_narrow_axis():
    narrow = [{"x": 10 + i, "y": i} for i in range(12)]
    spec = assemble_vegalite({
        "data": {"values": narrow},
        "semantic_types": {"x": "Number", "y": "Number"},
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {"x": {"field": "x"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
        },
    })
    assert "logScale_x" not in _applicable_keys(spec)


def test_unset_follows_engine_recommendation_log():
    spec = _scatter({"x": {"field": "x"}, "y": {"field": "y"}})
    assert (spec["encoding"]["x"].get("scale") or {}).get("type") == "log"
    opt = _option_for(spec, "logScale_x")
    assert opt is not None and opt.get("value") is True


def test_false_override_forces_linear_axis():
    spec = _scatter({"x": {"field": "x"}, "y": {"field": "y"}}, {"logScale_x": False})
    assert (spec["encoding"]["x"].get("scale") or {}).get("type") != "log"
    assert "logScale_x" in _applicable_keys(spec)


def test_true_forces_log_axis_when_not_recommended():
    vals = [{"x": (i + 1) * 50, "y": i} for i in range(12)]
    auto = assemble_vegalite({
        "data": {"values": vals},
        "semantic_types": {"x": "Number", "y": "Number"},
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {"x": {"field": "x"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
        },
    })
    assert (auto["encoding"]["x"].get("scale") or {}).get("type") != "log"

    forced = assemble_vegalite({
        "data": {"values": vals},
        "semantic_types": {"x": "Number", "y": "Number"},
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {"x": {"field": "x"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
            "chartProperties": {"logScale_x": True},
        },
    })
    assert (forced["encoding"]["x"].get("scale") or {}).get("type") == "log"


def test_symlog_for_true_toggle_with_zeros_in_data():
    with_zeros = [{"x": 0, "y": 0}] + [{"x": 10 ** (i * 0.6), "y": i + 1} for i in range(11)]
    spec = assemble_vegalite({
        "data": {"values": with_zeros},
        "semantic_types": {"x": "Number", "y": "Number"},
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {"x": {"field": "x"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
            "chartProperties": {"logScale_x": True},
        },
    })
    assert (spec["encoding"]["x"].get("scale") or {}).get("type") == "symlog"


def test_never_offers_log_on_bar_chart():
    spec = assemble_vegalite({
        "data": {"values": [{"cat": f"c{i}", "val": d["x"]} for i, d in enumerate(WIDE_X)]},
        "semantic_types": {"cat": "Category", "val": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "cat"}, "y": {"field": "val"}},
            "baseSize": CANVAS,
        },
    })
    has_log_option = any(o.get("key", "").startswith("logScale") for o in spec.get("_options", []))
    assert not has_log_option


def test_offers_log_only_on_value_axis_of_line_chart():
    series = [{
        "t": f"2020-{(i % 12) + 1:02d}-01",
        "v": 10 ** (i * 0.7),
    } for i in range(12)]
    spec = assemble_vegalite({
        "data": {"values": series},
        "semantic_types": {"t": "Date", "v": "Quantity"},
        "chart_spec": {
            "chartType": "Line Chart",
            "encodings": {"x": {"field": "t"}, "y": {"field": "v"}},
            "baseSize": CANVAS,
        },
    })
    keys = _applicable_keys(spec)
    assert "logScale_y" in keys
    assert "logScale_x" not in keys


def test_get_chart_options_matches_rendered_spec_options():
    inp = {
        "data": {"values": WIDE_X},
        "semantic_types": {"x": "Quantity", "y": "Number"},
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {"x": {"field": "x"}, "y": {"field": "y"}},
            "baseSize": CANVAS,
        },
    }
    spec = assemble_vegalite(inp)
    options = get_chart_options(inp)
    assert options == spec["_options"]
    keys = [o["key"] for o in options if o.get("applicable")]
    assert "logScale_x" in keys

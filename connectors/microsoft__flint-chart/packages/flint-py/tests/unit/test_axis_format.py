"""Port of tests/frontend/unit/lib/agents-chart/vegalite/axisFormat.test.ts."""
from __future__ import annotations

from flint.vegalite import assemble_vegalite

BASE_CANVAS = {"width": 400, "height": 300}


def test_adds_default_format_to_unformatted_quantitative_position_axes():
    spec = assemble_vegalite({
        "data": {
            "values": [
                {"category": "A", "value": 20},
                {"category": "B", "value": -50},
            ],
        },
        "semantic_types": {"category": "Category", "value": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "category"}, "y": {"field": "value"}},
            "baseSize": BASE_CANVAS,
        },
        "options": {"addTooltips": True},
    })

    assert spec["encoding"]["y"]["axis"]["format"] == ",.12~g"
    assert spec["encoding"]["x"].get("axis", {}).get("format") is None
    assert spec["config"].get("numberFormat") is None
    assert spec["config"]["mark"]["tooltip"] is True


def test_does_not_override_semantic_axis_formats():
    spec = assemble_vegalite({
        "data": {
            "values": [
                {"category": "A", "completionRate": 0.2},
                {"category": "B", "completionRate": 0.85},
            ],
        },
        "semantic_types": {
            "category": "Category",
            "completionRate": {"semanticType": "Percentage", "intrinsicDomain": [0, 1]},
        },
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "category"}, "y": {"field": "completionRate"}},
            "baseSize": BASE_CANVAS,
        },
        "options": {"addTooltips": True},
    })

    fmt = spec["encoding"]["y"]["axis"]["format"]
    assert fmt == ".0~%"
    assert fmt != ",.12~g"


def test_does_not_format_binned_axes():
    spec = assemble_vegalite({
        "data": {
            "values": [{"value": 1}, {"value": 2}, {"value": 3}],
        },
        "semantic_types": {"value": "Quantity"},
        "chart_spec": {
            "chartType": "Histogram",
            "encodings": {"x": {"field": "value"}},
            "baseSize": BASE_CANVAS,
        },
        "options": {"addTooltips": True},
    })

    assert spec["encoding"]["x"].get("bin")
    assert spec["encoding"]["x"].get("axis", {}).get("format") is None

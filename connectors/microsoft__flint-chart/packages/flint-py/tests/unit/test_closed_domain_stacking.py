"""Port of tests/frontend/unit/lib/agents-chart/vegalite/closedDomainStacking.test.ts."""
from __future__ import annotations

from flint.vegalite import assemble_vegalite

CANVAS = {"width": 600, "height": 400}


def test_drops_intrinsic_clamp_when_color_series_stacks_past_bound():
    products = ["A", "B", "C", "D"]
    series = ["s1", "s2", "s3", "s4"]
    values = []
    for p in products:
        for s in series:
            values.append({"product": p, "series": s, "corr": 0.9})
    spec = assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"product": "Category", "series": "Category", "corr": "Correlation"},
        "chart_spec": {
            "chartType": "Stacked Bar Chart",
            "encodings": {"x": {"field": "product"}, "y": {"field": "corr"}, "color": {"field": "series"}},
            "baseSize": CANVAS,
        },
    })
    scale = spec["encoding"]["y"].get("scale") or {}
    assert scale.get("domain") is None
    assert scale.get("clamp") is None


def test_drops_intrinsic_clamp_when_repeated_categories_stack_without_color():
    products = ["A", "B", "C", "D", "E"]
    values = []
    for p in products:
        for _ in range(4):
            values.append({"product": p, "corr": -0.21 if p == "C" else 0.9})
    spec = assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"product": "Category", "corr": "Correlation"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "product"}, "y": {"field": "corr"}},
            "baseSize": CANVAS,
        },
    })
    scale = spec["encoding"]["y"].get("scale") or {}
    assert scale.get("domain") is None
    assert scale.get("clamp") is None


def test_detects_overflow_on_negative_side_even_when_signed_totals_cancel():
    products = ["A", "B"]
    values = []
    for p in products:
        for _ in range(3):
            values.append({"product": p, "corr": 0.5})
        for _ in range(4):
            values.append({"product": p, "corr": -0.5})
    spec = assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"product": "Category", "corr": "Correlation"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "product"}, "y": {"field": "corr"}},
            "baseSize": CANVAS,
        },
    })
    scale = spec["encoding"]["y"].get("scale") or {}
    assert scale.get("domain") is None


def test_keeps_intrinsic_domain_for_non_stacking_chart():
    values = [
        {"product": "A", "corr": 0.9},
        {"product": "B", "corr": -0.21},
        {"product": "C", "corr": 0.4},
    ]
    spec = assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"product": "Category", "corr": "Correlation"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "product"}, "y": {"field": "corr"}},
            "baseSize": CANVAS,
        },
    })
    scale = spec["encoding"]["y"].get("scale") or {}
    assert scale.get("domain") == [-1, 1]

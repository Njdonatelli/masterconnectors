"""Port of tests/frontend/unit/lib/agents-chart/sortAction.test.ts."""
from __future__ import annotations

from flint.core.encoding_actions import make_sort_action
from flint.vegalite import assemble_vegalite

BASE_CANVAS = {"width": 400, "height": 300}

action = make_sort_action()


# ── get — derive control value from base encodings ─────────────────────────

def test_get_returns_none_when_no_sort_is_set():
    enc = {"x": {"field": "cat", "type": "nominal"}, "y": {"field": "val", "aggregate": "sum"}}
    assert action["get"](enc) is None


def test_get_reads_value_sort_referencing_measure_channel():
    enc = {
        "x": {"field": "cat", "type": "nominal", "sortBy": "y", "sortOrder": "descending"},
        "y": {"field": "val", "aggregate": "sum"},
    }
    assert action["get"](enc) == "value-desc"


def test_get_treats_bare_label_sort_as_default():
    enc = {
        "x": {"field": "cat", "type": "nominal", "sortOrder": "ascending"},
        "y": {"field": "val", "aggregate": "sum"},
    }
    assert action["get"](enc) is None


def test_get_treats_unrepresentable_sorts_as_default():
    enc = {
        "x": {"field": "cat", "type": "nominal", "sortBy": '["B","A"]'},
        "y": {"field": "val", "aggregate": "sum"},
    }
    assert action["get"](enc) is None


def test_get_detects_horizontal_orientation():
    enc = {
        "x": {"field": "val", "aggregate": "sum"},
        "y": {"field": "cat", "type": "nominal", "sortBy": "x", "sortOrder": "ascending"},
    }
    assert action["get"](enc) == "value-asc"


def test_get_returns_none_when_category_axis_is_temporal():
    enc = {
        "x": {"field": "month", "type": "temporal"},
        "y": {"field": "val", "type": "quantitative", "aggregate": "sum"},
    }
    assert action["get"](enc) is None


def test_get_returns_none_when_both_axes_are_quantitative():
    enc = {
        "x": {"field": "a", "type": "quantitative"},
        "y": {"field": "b", "type": "quantitative"},
    }
    assert action["get"](enc) is None


# ── isApplicable — type-aware visibility gate ──────────────────────────────

def test_is_applicable_when_discrete_category_and_measure_pair_exists():
    enc = {"x": {"field": "cat", "type": "nominal"}, "y": {"field": "val", "aggregate": "sum"}}
    assert action["isApplicable"]({"encodings": enc}) is True


def test_is_not_applicable_for_temporal_x_time_series():
    enc = {
        "x": {"field": "month", "type": "temporal"},
        "y": {"field": "val", "type": "quantitative", "aggregate": "sum"},
    }
    assert action["isApplicable"]({"encodings": enc}) is False


def test_is_not_applicable_when_no_measure_axis_exists():
    enc = {"x": {"field": "cat", "type": "nominal"}, "y": {"field": "cat2", "type": "nominal"}}
    assert action["isApplicable"]({"encodings": enc}) is False


# ── set — compose the override onto the category channel ──────────────────

ENC = {"x": {"field": "cat", "type": "nominal"}, "y": {"field": "val", "aggregate": "sum"}}


def test_set_value_desc_writes_sortby_measure_descending():
    nxt = action["set"](ENC, "value-desc")
    assert nxt["x"]["sortBy"] == "y"
    assert nxt["x"]["sortOrder"] == "descending"


def test_set_default_clears_both_sort_fields():
    sorted_ = action["set"](ENC, "value-desc")
    cleared = action["set"](sorted_, None)
    assert cleared["x"].get("sortBy") is None
    assert cleared["x"].get("sortOrder") is None


def test_set_does_not_mutate_input_encodings():
    action["set"](ENC, "value-desc")
    assert "sortBy" not in ENC["x"]


def test_set_targets_category_channel_under_horizontal_orientation():
    horizontal = {"x": {"field": "val", "aggregate": "sum"}, "y": {"field": "cat", "type": "nominal"}}
    nxt = action["set"](horizontal, "value-asc")
    assert nxt["y"]["sortBy"] == "x"
    assert nxt["y"]["sortOrder"] == "ascending"
    assert nxt["x"].get("sortBy") is None


def test_set_is_noop_when_no_discrete_category_axis():
    temporal = {
        "x": {"field": "month", "type": "temporal"},
        "y": {"field": "val", "type": "quantitative", "aggregate": "sum"},
    }
    nxt = action["set"](temporal, "value-desc")
    assert nxt is temporal


# ── end-to-end: override composed by the compiler ─────────────────────────

DATA = {
    "values": [
        {"category": "A", "value": 20},
        {"category": "B", "value": 50},
        {"category": "C", "value": 10},
    ],
}


def test_value_desc_override_sorts_bar_x_axis_by_measure():
    spec = assemble_vegalite({
        "data": DATA,
        "semantic_types": {"category": "Category", "value": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "category"}, "y": {"field": "value", "aggregate": "sum"}},
            "chartProperties": {"sort": "value-desc"},
            "baseSize": BASE_CANVAS,
        },
    })
    assert spec["encoding"]["x"]["sort"] == "-y"


def test_no_override_leaves_template_default_ordering():
    spec = assemble_vegalite({
        "data": DATA,
        "semantic_types": {"category": "Category", "value": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "category"}, "y": {"field": "value", "aggregate": "sum"}},
            "baseSize": BASE_CANVAS,
        },
    })
    assert spec["encoding"]["x"].get("sort") != "-y"


def test_value_desc_applies_when_measure_type_is_auto():
    spec = assemble_vegalite({
        "data": DATA,
        "semantic_types": {"category": "Category", "value": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "category"}, "y": {"field": "value"}},
            "chartProperties": {"sort": "value-desc"},
            "baseSize": BASE_CANVAS,
        },
    })
    assert spec["encoding"]["x"]["sort"] == "-y"


def test_value_desc_overrides_field_intrinsic_ordinal_ordering():
    spec = assemble_vegalite({
        "data": {"values": [
            {"budget": "Under $10M", "pct": 65},
            {"budget": "$10M-$30M", "pct": 62},
            {"budget": "$30M-$70M", "pct": 64},
            {"budget": "$70M-$150M", "pct": 76},
            {"budget": "$150M+", "pct": 97},
        ]},
        "semantic_types": {
            "budget": {
                "semanticType": "Category",
                "sortOrder": ["Under $10M", "$10M-$30M", "$30M-$70M", "$70M-$150M", "$150M+"],
            },
            "pct": "Percentage",
        },
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "budget", "type": "ordinal"}, "y": {"field": "pct"}},
            "chartProperties": {"sort": "value-desc"},
            "baseSize": BASE_CANVAS,
        },
    })
    assert spec["encoding"]["x"]["sort"] == "-y"

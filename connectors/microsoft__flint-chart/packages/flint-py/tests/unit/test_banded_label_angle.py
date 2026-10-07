"""Port of tests/frontend/unit/lib/agents-chart/vegalite/bandedLabelAngle.test.ts."""
from __future__ import annotations

from flint.vegalite import assemble_vegalite

CANVAS = {"width": 400, "height": 300}


def test_rotates_many_wide_numeric_labels_on_banded_ordinal_x_axis():
    values = [{"bucket": 1_000_000 + i * 125_000, "count": 10 + (i % 7)} for i in range(30)]
    spec = assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"bucket": "Quantity", "count": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "bucket", "type": "ordinal"}, "y": {"field": "count"}},
            "baseSize": CANVAS,
        },
    })
    assert spec["config"]["axisX"]["labelAngle"] == -45


def test_keeps_few_short_numeric_labels_horizontal():
    values = [
        {"bucket": 1, "count": 10},
        {"bucket": 2, "count": 20},
        {"bucket": 3, "count": 15},
    ]
    spec = assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"bucket": "Quantity", "count": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "bucket", "type": "ordinal"}, "y": {"field": "count"}},
            "baseSize": CANVAS,
        },
    })
    assert spec["config"]["axisX"]["labelAngle"] == 0


def test_continuous_quantitative_x_axis_left_to_vl_overlap_handling():
    values = [{"bucket": 1_000_000 + i * 125_000, "count": 10 + (i % 7)} for i in range(25)]
    spec = assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"bucket": "Quantity", "count": "Quantity"},
        "chart_spec": {
            "chartType": "Bar Chart",
            "encodings": {"x": {"field": "bucket"}, "y": {"field": "count"}},
            "baseSize": CANVAS,
        },
    })
    assert (spec.get("config", {}).get("axisX") or {}).get("labelAngle") is None


# --- Categorical band-fit (box plots with a small defaultBandSize) ------------
# Regression: short string categories on a narrow band must not be forced
# horizontal when the widest label is wider than the band step, or they overlap
# ("regularidgradepremium"). Widen the band within budget, else angle to -45.

APPROX_CHAR_WIDTH_RATIO = 0.62


def _boxplot_spec(grades, width):
    seed = [1]

    def rnd():
        seed[0] = (seed[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return seed[0] / 0x7FFFFFFF

    values = [{"Grade": g, "Price": round(rnd() * 100)} for g in grades for _ in range(20)]
    return assemble_vegalite({
        "data": {"values": values},
        "semantic_types": {"Grade": "Category", "Price": "Quantity"},
        "chart_spec": {
            "chartType": "Boxplot",
            "encodings": {"x": {"field": "Grade"}, "y": {"field": "Price"}},
            "baseSize": {"width": width, "height": 300},
        },
    })


def _assert_non_overlapping(grades, spec):
    axis_x = spec.get("config", {}).get("axisX") or {}
    label_angle = axis_x.get("labelAngle")
    font_size = axis_x.get("labelFontSize")
    width = spec.get("width")
    step = width["step"] if isinstance(width, dict) else None
    max_len = max(len(g) for g in grades)
    label_px = max_len * font_size * APPROX_CHAR_WIDTH_RATIO
    horizontal_fits = label_angle == 0 and step is not None and step >= label_px
    assert horizontal_fits or label_angle == -45


def test_boxplot_widens_band_to_keep_wide_labels_horizontal():
    grades = ["regular", "midgrade", "premium"]  # longest 8 chars > 28px box band
    spec = _boxplot_spec(grades, 300)
    assert spec["width"]["step"] > 28  # widened beyond the box defaultBandSize
    assert spec["config"]["axisX"]["labelAngle"] == 0
    _assert_non_overlapping(grades, spec)


def test_boxplot_angles_labels_when_budget_cannot_fit():
    grades = ["regular_", "midgrade", "premium_", "superpr_"]
    spec = _boxplot_spec(grades, 60)  # tiny canvas -> tight per-band budget
    assert spec["config"]["axisX"]["labelAngle"] == -45
    _assert_non_overlapping(grades, spec)


def test_boxplot_keeps_band_when_short_labels_already_fit():
    grades = ["A", "B", "C"]
    spec = _boxplot_spec(grades, 300)
    assert spec["width"]["step"] == 28  # box defaultBandSize, no widening
    assert spec["config"]["axisX"]["labelAngle"] == 0
    _assert_non_overlapping(grades, spec)


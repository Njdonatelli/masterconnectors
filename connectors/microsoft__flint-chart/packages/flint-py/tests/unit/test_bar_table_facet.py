"""Port of tests/frontend/unit/lib/agents-chart/vegalite/barTableFacet.test.ts.

The TS test also runs `compile(spec)` from vega-lite. Python has no vega-lite
compile equivalent in this project, so we skip that assertion.
"""
from __future__ import annotations

from flint.vegalite import assemble_vegalite

CANVAS = {"width": 400, "height": 300}

ENCODING = {
    "y": {"field": "agency"},
    "x": {"field": "launches"},
    "column": {"field": "agency_type"},
}

SEMANTIC_TYPES = {
    "agency": "Category",
    "launches": "Quantity",
    "agency_type": "Category",
}


def test_hoists_column_facets_around_hconcat_bar_table_and_wraps():
    data = [
        {"agency_type": "state", "agency": "RVSN", "launches": 1528},
        {"agency_type": "state", "agency": "UNKS", "launches": 904},
        {"agency_type": "state", "agency": "NASA", "launches": 469},
        {"agency_type": "private", "agency": "Arianespace", "launches": 258},
        {"agency_type": "private", "agency": "ILS-K", "launches": 97},
        {"agency_type": "startup", "agency": "SpaceX", "launches": 65},
    ]

    spec = assemble_vegalite({
        "data": {"values": data},
        "semantic_types": SEMANTIC_TYPES,
        "chart_spec": {
            "chartType": "Bar Table",
            "encodings": ENCODING,
            "baseSize": CANVAS,
        },
    })

    assert spec["facet"] == {"field": "agency_type", "type": "nominal", "sort": None}
    assert spec["columns"] == 2
    assert spec.get("hconcat") is None
    assert len(spec["spec"]["hconcat"]) == 2
    assert spec["spec"]["hconcat"][0].get("data") is None
    assert spec["data"] == {"name": "__bt_displayTable"}
    assert spec["resolve"]["scale"]["y"] == "independent"
    assert spec["spec"]["resolve"]["scale"]["y"] == "shared"
    assert spec["spec"]["hconcat"][0]["width"] < CANVAS["width"]
    assert spec["spec"]["hconcat"][0]["height"] < CANVAS["height"]
    assert spec["spec"]["hconcat"][0]["encoding"]["y"]["axis"]["labelFontSize"] < 13
    assert spec["spec"]["hconcat"][1]["mark"]["fontSize"] < 12


def test_rolls_rows_up_within_each_facet_without_undefined_facet():
    data = [
        {"agency_type": "state", "agency": "RVSN", "launches": 100},
        {"agency_type": "state", "agency": "UNKS", "launches": 90},
        {"agency_type": "state", "agency": "NASA", "launches": 80},
        {"agency_type": "state", "agency": "USAF", "launches": 70},
        {"agency_type": "private", "agency": "Arianespace", "launches": 60},
        {"agency_type": "private", "agency": "ILS-K", "launches": 50},
        {"agency_type": "private", "agency": "ULA", "launches": 40},
        {"agency_type": "private", "agency": "Boeing", "launches": 30},
    ]

    spec = assemble_vegalite({
        "data": {"values": data},
        "semantic_types": SEMANTIC_TYPES,
        "chart_spec": {
            "chartType": "Bar Table",
            "encodings": ENCODING,
            "baseSize": CANVAS,
            "chartProperties": {"maxRows": 3},
        },
    })

    display_rows = spec["datasets"]["__bt_displayTable"]
    assert len(display_rows) == 6
    others = [row for row in display_rows if row.get("__bt_others")]
    assert len(others) == 2
    state_other = next(r for r in others if r["agency_type"] == "state")
    private_other = next(r for r in others if r["agency_type"] == "private")
    assert state_other["agency"] == "Others (+2)"
    assert state_other["launches"] == 150
    assert private_other["agency"] == "Others (+2)"
    assert private_other["launches"] == 70
    assert all(row["agency_type"] in ("state", "private") for row in display_rows)


def test_computes_percentage_totals_within_each_facet():
    data = [
        {"agency_type": "state", "agency": "RVSN", "launches": 100},
        {"agency_type": "state", "agency": "UNKS", "launches": 50},
        {"agency_type": "private", "agency": "Arianespace", "launches": 40},
        {"agency_type": "private", "agency": "ILS-K", "launches": 10},
    ]

    spec = assemble_vegalite({
        "data": {"values": data},
        "semantic_types": SEMANTIC_TYPES,
        "chart_spec": {
            "chartType": "Bar Table",
            "encodings": {**ENCODING, "color": {"field": "agency_type"}},
            "baseSize": CANVAS,
            "chartProperties": {"showPercent": True},
        },
    })

    assert len(spec["spec"]["hconcat"]) == 3
    percent_panel = spec["spec"]["hconcat"][1]
    assert percent_panel["transform"][0]["groupby"] == ["agency_type", "agency"]
    assert percent_panel["transform"][1] == {
        "joinaggregate": [{"op": "sum", "field": "__bt_val", "as": "__bt_total"}],
        "groupby": ["agency_type"],
    }
    assert percent_panel["transform"][2] == {
        "calculate": "datum.__bt_total === 0 ? null : datum.__bt_val / datum.__bt_total",
        "as": "__bt_pct",
    }

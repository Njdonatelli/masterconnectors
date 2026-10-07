"""Channel field shorthand: a bare string is treated as {"field": <string>}."""
from __future__ import annotations

from flint.vegalite import assemble_vegalite
from flint.vegalite.assemble import (
    _coerce_encoding_value,
    normalize_encoding_shorthand,
)

DATA = [
    {"weight": 1.6, "mpg": 32, "origin": "JP"},
    {"weight": 2.1, "mpg": 27, "origin": "US"},
    {"weight": 1.9, "mpg": 29, "origin": "EU"},
]
SEMANTIC = {"weight": "Quantity", "mpg": "Quantity", "origin": "Country"}
CANVAS = {"width": 400, "height": 300}


def test_coerce_expands_bare_string():
    assert _coerce_encoding_value("weight") == {"field": "weight"}


def test_coerce_expands_strings_in_list():
    assert _coerce_encoding_value(["sales", "profit"]) == [
        {"field": "sales"},
        {"field": "profit"},
    ]


def test_coerce_passes_through_objects():
    assert _coerce_encoding_value({"field": "mpg", "type": "quantitative"}) == {
        "field": "mpg",
        "type": "quantitative",
    }


def test_normalize_mixes_shorthand_and_full():
    assert normalize_encoding_shorthand(
        {"x": "weight", "y": {"field": "mpg"}}
    ) == {"x": {"field": "weight"}, "y": {"field": "mpg"}}


def test_shorthand_spec_matches_explicit_spec():
    shorthand = assemble_vegalite({
        "data": {"values": DATA},
        "semantic_types": SEMANTIC,
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {"x": "weight", "y": "mpg", "color": "origin"},
            "baseSize": CANVAS,
        },
    })
    explicit = assemble_vegalite({
        "data": {"values": DATA},
        "semantic_types": SEMANTIC,
        "chart_spec": {
            "chartType": "Scatter Plot",
            "encodings": {
                "x": {"field": "weight"},
                "y": {"field": "mpg"},
                "color": {"field": "origin"},
            },
            "baseSize": CANVAS,
        },
    })
    assert shorthand == explicit

# Example: a data story

A simple line chart is enough to learn the shape of a Flint spec. The fun starts
when the question gets messier.

This example uses a game-market dataset: monthly active users for a portfolio of
games, split by month, title, game type, and region. We will move through the
same source data three ways:

- **Overview**: where are the users, and how do trends differ by region?
- **Change**: what moved the portfolio up or down?
- **Composition**: how does the latest portfolio break down by region, type, and
  title?

One important bit of honesty up front: Flint is a chart compiler, not a full ETL
engine. It expects the rows you pass it to already match the view you want to
draw. In this story, the views are all derived from the same source dataset, but
some charts use summarized chart-ready tables. The waterfall is intentionally
simple: it uses monthly `period` / `newUsers` rows, with the first and last
periods treated as the start/end bars by the template.

That is still the point. Once a view exists, the chart request stays small: a
DataSpec says what the view's fields mean, and a ChartSpec says how to draw it.

## Start from the real source

The source table has one row per `period × game × region`, with the game type
attached to each title:

| period | game | gameType | region | newUsers | totalUsers |
|--------|------|----------|--------|----------|------------|
| 2025-01 | Starforge Tactics | PC / Client | N | 5997 | 10173 |
| 2025-01 | Starforge Tactics | PC / Client | E | 682 | 4475 |
| 2025-01 | Starforge Tactics | PC / Client | S | -886 | 1917 |
| 2025-01 | Starforge Tactics | PC / Client | W | -1619 | 605 |
| 2025-01 | Neon Drift 2049 | Console | N | 8195 | 14920 |
| ... | ... | ... | ... | ... | ... |

The DataSpec names those columns and records what they mean:

```json
{
  "data": { "values": [ /* period × game × gameType × region rows */ ] },
  "semantic_types": {
    "period": "YearMonth",
    "game": "Category",
    "gameType": "Category",
    "newUsers": "Profit",
    "totalUsers": "Quantity",
    "region": { "semanticType": "Category", "sortOrder": ["N", "E", "S", "W"] }
  }
}
```

Those semantic labels carry more than names:

- `YearMonth` tells Flint to parse `period` as time and format month ticks.
- `Quantity` gives `totalUsers` a numeric axis.
- `Profit` marks `newUsers` as signed, so a heatmap can use a diverging scale
  around zero.
- `region.sortOrder` makes regional panels read N, E, S, W instead of whatever
  order the raw table happens to use.

The live examples below use chart-ready views derived from that source:

- line view: `sum(totalUsers)` by `region × period × gameType`;
- grouped bar view: `sum(totalUsers)` by `period × gameType`;
- waterfall view: `sum(newUsers)` by `period`, with first/last periods
  auto-treated as start/end bars;
- heatmap view: `sum(newUsers)` by `game × period`;
- sunburst view: latest-month `region × gameType × game` rows sized by
  `totalUsers`.

An AI agent, SQL query, notebook, or application layer can prepare those views.
Flint then handles the chart-specific compilation: axes, marks, color, layout,
and backend syntax.

## Act 1: overview

First, ask a broad question: where are the users?

The line view contains `region`, `period`, `gameType`, and `totalUsers`. A
faceted line chart gives one panel per region and one line per game type:

```json
"chart_spec": {
  "chartType": "Line Chart",
  "encodings": {
    "column": { "field": "region" },
    "x": { "field": "period" },
    "y": { "field": "totalUsers" },
    "color": { "field": "gameType" }
  }
}
```

```flint-chart
{ "generator": "Omni: Line", "canvasSize": { "width": 360, "height": 520 } }
```

What to notice:

- The ChartSpec says `column: region`; Flint handles the small-multiple layout.
- `period` stays a temporal axis because the DataSpec says `YearMonth`.
- The chart grows into a readable faceted layout instead of squeezing every panel
  into the base size.

Now switch the view from regional trend panels to a monthly comparison. The
grouped bar view has `period`, `gameType`, and `totalUsers`:

```json
"chart_spec": {
  "chartType": "Grouped Bar Chart",
  "encodings": {
    "x": { "field": "period" },
    "y": { "field": "totalUsers" },
    "color": { "field": "gameType" },
    "group": { "field": "gameType" }
  }
}
```

```flint-chart
{ "generator": "Omni: Grouped Bar", "canvasSize": { "width": 640, "height": 340 }, "options": { "maxStretch": 1 } }
```

This is the first payoff: the chart design changes from faceted lines to grouped
bars by swapping the template and a few channels. The source semantics stay the
same, even though the grouped-bar view is summarized differently.

## Act 2: change

The overview says where the users are. Now ask how the portfolio got there. For
this waterfall, the view is just one row per month: `period` plus monthly
`newUsers` summed across the portfolio. No explicit start/end/type column is
needed; the template treats the first period as the start bar, the last period as
the end bar, and the months in between as deltas.

The ChartSpec is just a mapping:

```json
"chart_spec": {
  "chartType": "Waterfall Chart",
  "encodings": {
    "x": { "field": "period" },
    "y": { "field": "newUsers" }
  }
}
```

```flint-chart
{ "generator": "Omni: Waterfall", "canvasSize": { "width": 640, "height": 360 }, "options": { "maxStretch": 1 } }
```

The bespoke part lives in the template: connectors, start/end inference, delta
bars, and backend-specific waterfall syntax. The spec only names the period and
the measure.

To see which games drove the swings, use another derived view: `sum(newUsers)`
by `game × period`. A heatmap puts month on x, game on y, and net users into
color:

```json
"chart_spec": {
  "chartType": "Heatmap",
  "encodings": {
    "x": { "field": "period" },
    "y": { "field": "game" },
    "color": { "field": "newUsers" }
  }
}
```

```flint-chart
{ "generator": "Omni: Heatmap", "canvasSize": { "width": 640, "height": 460 }, "options": { "maxStretch": 1 } }
```

This is where semantic types do work that is easy to miss in a simple chart.
Because `newUsers` is treated as `Profit`, Flint knows zero is meaningful and
can use a diverging red-blue scale instead of a generic sequential ramp.

## Act 3: composition

Finally, ask what the latest portfolio is made of.

The sunburst view filters to the latest month, then keeps `region`, `gameType`,
`game`, and `totalUsers`. The ChartSpec describes a hierarchy: region, then game
type, then individual game, sized by total users.

```json
"chart_spec": {
  "chartType": "Sunburst Chart",
  "encodings": {
    "color": { "field": "region" },
    "group": { "field": "gameType" },
    "detail": { "field": "game" },
    "size": { "field": "totalUsers" }
  }
}
```

```flint-chart
echarts
{ "generator": "Omni: Sunburst", "canvasSize": { "width": 460, "height": 460 } }
```

This chart also demonstrates a backend switch. Vega-Lite does not have a native
sunburst primitive, so the render uses ECharts. The input still reads like
Flint: fields, channels, semantics. The backend changes because the design needs
an ECharts-native chart type.

## What this example shows

The same source dataset moved through five chart-ready views and five chart
designs:

- faceted line chart for regional trends;
- grouped bar chart for monthly comparison;
- waterfall chart for portfolio change;
- heatmap for game-by-month movement;
- sunburst chart for hierarchical composition.

Three Flint features are doing most of the chart work:

- **Semantic types drive low-level settings.** Time parsing, quantitative axes,
  diverging color, and ordered facets come from the DataSpec.
- **Auto layout keeps complex views readable.** Facets, grouped bars, dense
  heatmaps, and radial charts can expand or scale within the available canvas.
- **Chart designs and backends are cheap to switch.** Once the view has the
  right fields, the ChartSpec changes by a few lines, and the final assembler can
  target Vega-Lite, ECharts, or Chart.js when the chart type is supported.

That is the realistic promise behind the example: prepare the right view, label
what its fields mean, then change the chart design without hand-writing backend
specs.

## Next steps

- [Getting started](/documentation/getting-started) introduces DataSpec and ChartSpec
  with a tiny first chart.
- [Gallery](/gallery) shows every chart template and backend combination.
- [Semantic Type](/documentation/semantic-types) explains how semantic labels
  drive defaults such as time parsing, color, and aggregation behavior.
- [Auto Layout Algorithm](/documentation/layout-model) explains how Flint sizes
  dense, faceted, and hierarchical views.
- [Online editor](/editor) lets you edit Flint specs live.

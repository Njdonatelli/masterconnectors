# Color decisions

Flint separates **what kind of color scale to use** (categorical, sequential, or
diverging) from **how each backend renders it**. Color logic runs in two layers:

1. **Phase 0 — semantic resolution** assigns each channel a
   `ChannelSemantics.colorScheme` recommendation from field semantic types and
   data (used directly by Vega-Lite).
2. **`decideColorMaps()`** in `core/color-decisions.ts` turns semantics +
   encodings into backend-agnostic `ColorDecision` records (used by ECharts and
   Chart.js, which then pick concrete hex palettes locally).

Neither layer emits Vega-Lite or ECharts syntax — only abstract scheme *types*,
optional explicit scheme ids, category counts, and diverging midpoints.

---

## Where it runs in the pipeline

```
resolveChannelSemantics()          Phase 0
    └── cs.colorScheme             { type, scheme, domainMid? }
              │
              ├─► Vega-Lite assemble
              │     buildVLEncodings() copies scheme → encoding.scale.scheme
              │     (VL built-in scheme names: category10, viridis, redblue, …)
              │
              └─► ECharts / Chart.js assemble
                    decideColorMaps() → ColorDecisionResult
                          └── pickEChartsPalette() / pickChartJsPalette()
                                └── hex color arrays on series / legend
```

| Backend | Color entry point | Palette source |
|---------|-------------------|----------------|
| Vega-Lite | `ChannelSemantics.colorScheme` in `vegalite/assemble.ts` | `getRecommendedColorScheme()` → [Vega scheme names](https://vega.github.io/vega/docs/schemes/) |
| ECharts | `decideColorMaps()` → `context.colorDecisions` | `echarts/colormap.ts` — `cat10`, `cat20`, `viridis`, `RdBu` |
| Chart.js | `decideColorMaps()` → `context.colorDecisions` | `chartjs/colormap.ts` — same ids, Chart.js-tuned hex values |

ECharts and Chart.js call `decideColorMaps()` once during assembly and attach the
result to `InstantiateContext.colorDecisions`. Templates and
`instantiate-spec.ts` read that object; they do not re-derive scheme families.

---

## Phase 0: semantic color hints

During `resolveChannelSemantics()`, color-bearing channels (`color`, and
sometimes `group`) receive a `colorScheme` on `ChannelSemantics`:

```ts
interface ColorSchemeRecommendation {
  scheme: string;   // e.g. 'tableau10', 'viridis', 'redblue'
  type: 'categorical' | 'sequential' | 'diverging';
  domainMid?: number;
  reason?: string;
}
```

Production path:

1. `resolveColorSchemeHint(semanticType, annotation, values)` — classifies
   diverging vs sequential vs categorical from type registry and data range.
2. `getRecommendedColorScheme(...)` in `core/semantic-types.ts` — picks a
   concrete Vega-Lite scheme name from the internal `colorSchemes` registry.

Examples:

| Semantic type | Typical hint | Example scheme |
|---------------|--------------|----------------|
| `Country`, `Category` | categorical | `tableau10` / `tableau20` by cardinality |
| `Quantity`, `Temperature` | sequential | `viridis`, `reds`, … |
| `Percentage`, `Correlation` (spans ±) | diverging | `redblue` with `domainMid` |

Vega-Lite encoding build then applies:

- User `encoding.scheme` if set and not `'default'`, else
- `cs.colorScheme.scheme` and `domainMid` for diverging scales.

See [Semantic Type](/documentation/semantic-types) for how types feed these hints.

---

## Core: `decideColorMaps()`

**File:** `packages/flint-js/src/core/color-decisions.ts`

### Input

```ts
interface DecideColorMapsContext {
  chartType: string;
  encodings: Record<string, ChartEncoding>;
  channelSemantics: Record<string, ChannelSemantics>;
  table: any[];
  background?: 'light' | 'dark';  // reserved
}
```

### Output

```ts
interface ColorDecisionResult {
  color?: ColorDecision;
  group?: ColorDecision;
  fill?: ColorDecision;    // reserved
  stroke?: ColorDecision;  // reserved
}

interface ColorDecision {
  channel: 'color' | 'group' | 'fill' | 'stroke';
  schemeType: 'categorical' | 'sequential' | 'diverging';
  schemeId?: string;           // set when user passes encoding.scheme
  divergingMidpoint?: number;
  categoryCount?: number;      // distinct values in the color field
  primary: boolean;            // true for color / group
  dataDriven: boolean;
}
```

Only channels with a bound field get a decision. Today **`color` and `group`**
are evaluated; `fill` / `stroke` are reserved.

### Per-channel algorithm

`decideColorForChannel()` runs in order:

1. **Explicit scheme** — If `encoding.scheme` is set and not `'default'`, pass
   `schemeId` through. Infer `schemeType` from `ChannelSemantics` (core does not
   validate the id; backends look it up in their registries).

2. **Semantic-driven type** — `decideSchemeTypeFromChannel()` reads
   `cs.colorScheme` and encoding/semantic context:

| Condition | `schemeType` |
|-----------|--------------|
| `colorScheme.type === 'diverging'` | `diverging` (+ `domainMid` as midpoint) |
| `colorScheme.type === 'sequential'` | `sequential` |
| `colorScheme.type === 'categorical'` + semantic `Rank` | `sequential` (rank on continuous ramp) |
| `colorScheme.type === 'categorical'` + `temporal` on `color` | `sequential` (avoid discrete dates as categories) |
| `colorScheme.type === 'categorical'` (default) | `categorical` |
| No hint + semantic `Correlation` | `diverging`, midpoint `0` |
| No hint + encoding `quantitative` or `temporal` | `sequential` |
| Fallback | `categorical` |

3. **Cardinality** — `countDistinctValues(table, field)` → `categoryCount` for
   backend palette sizing (e.g. `cat10` vs `cat20`).

Core intentionally does **not** pick a default `schemeId` on the automatic path.
Backends choose palettes from `schemeType` + `categoryCount` unless the user
overrode `scheme`.

---

## Backend palette registries

### ECharts — `echarts/colormap.ts`

Built-in maps: `cat10`, `cat20`, `viridis`, `RdBu`. Each entry includes `type`,
`supportsDiscrete`, `supportsContinuous`, `maxCategories`, `colorblindSafe`, and
a `colors: string[]` array.

**`pickEChartsPalette(decision)`**

1. If `decision.schemeId` is set → `getPaletteForScheme(id)`.
2. Else filter maps by `decision.schemeType`:
   - **categorical** — smallest `maxCategories` ≥ `categoryCount` (prefer `cat10` / `cat20`).
   - **sequential** — first continuous-capable map (typically `viridis`).
   - **diverging** — map with `diverging: true` (typically `RdBu`).
3. Fallback → `DEFAULT_COLORS` from ECharts templates.

**`getPaletteForScheme(id)`** — lookup by id (case-insensitive); used by templates
(Treemap, Heatmap, Graph, etc.) when they need colors directly.

### Chart.js — `chartjs/colormap.ts`

Same structure and selection strategy as ECharts, with Chart.js-default hex
values. Fallback → `cat10`.

### Vega-Lite

No `decideColorMaps()` call. Schemes are **names** resolved in Phase 0
(`category10`, `tableau20`, `viridis`, `redblue`, …) and written to
`encoding.scale.scheme` during `buildVLEncodings()`.

---

## User overrides

Set `scheme` on any color encoding in `chart_spec.encodings`:

```json
"encodings": {
  "color": { "field": "region", "scheme": "viridis" }
}
```

| Backend | Effect |
|---------|--------|
| Vega-Lite | `scale.scheme = "viridis"` (Vega built-in name) |
| ECharts / Chart.js | `ColorDecision.schemeId = "viridis"` → palette lookup in backend registry |

Use ids that exist in the target backend registry (`cat10`, `viridis`, `RdBu`, …)
for portable results across ECharts and Chart.js. Vega-Lite accepts the broader
[Vega scheme catalog](https://vega.github.io/vega/docs/schemes/).

---

## Design rationale

**Decision vs rendering** — Scheme *family* and cardinality are decided once in
core (or Phase 0 for VL). Hex arrays and scale objects stay in backend code, so
ECharts and Chart.js can diverge visually without forking semantic logic.

**Shared semantics** — The same `ChartAssemblyInput` yields the same
`schemeType` and `categoryCount` on ECharts and Chart.js. Only palette hex
values differ per backend theme.

**Graceful paths** — Explicit `encoding.scheme` wins. Otherwise semantics and
encoding types drive the family; backends always have a fallback palette.

### Extension points

| Change | Where |
|--------|--------|
| New semantic → scheme rule | `getRecommendedColorScheme()` / `resolveColorSchemeHint()` |
| New scheme family rule | `decideSchemeTypeFromChannel()` |
| New ECharts / Chart.js palette | `ECHARTS_COLOR_MAPS` / `CHARTJS_COLOR_MAPS` |
| New color channel | `ColorChannel` union + loop in `decideColorMaps()` |
| Vega-Lite unified path | Call `decideColorMaps()` in `vegalite/assemble.ts` (not wired today) |

---

## Related

- [Semantic Type](/documentation/semantic-types) — type registry and
  `colorScheme` hints in Phase 0
- [Architecture](/documentation/architecture) — full compile pipeline
- [API reference](/documentation/api-reference) — `ChartEncoding.scheme`

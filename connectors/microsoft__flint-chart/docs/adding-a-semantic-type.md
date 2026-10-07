# Extending semantic types

Semantic types are the labels LLMs and users attach to fields. Extend them when a new field meaning should change how Flint formats values, aggregates data, chooses scales, or assigns color. If Flint does not recognize a type, it falls back gracefully to `Unknown`.

For the full type hierarchy and resolution rules, see [Semantic Type](/documentation/semantic-types).

---

## Table of Contents

- [§1 Decide whether a new type is needed](#1-decide-whether-a-new-type-is-needed)
- [§2 Register the type](#2-register-the-type)
- [§3 Sync constants and annotations](#3-sync-constants-and-annotations)
- [§4 Test and verify](#4-test-and-verify)
- [§5 Related](#5-related)

---

# §1 Decide whether a new type is needed

Before adding a type, confirm it **changes compilation behavior** compared with its T1 parent. Avoid registering synonyms such as `Money`, `Price`, and `Currency`; pick one name for the registry and alias the others in agent prompts if needed.

| Question | If yes |
|---|---|
| Does an existing T2 type already compile the same way? | Use that type + `SemanticAnnotation` metadata instead |
| Does the type need a bounded scale or unit? | Keep the type; document required `intrinsicDomain` / `unit` in annotations |
| Is it only a friendlier label for agents? | Prefer T1 (`Amount`, `SignedMeasure`) over a new T2 |

Dropped-type guidance and the full inventory live in [Semantic Type §2.4](/documentation/semantic-types#24-tier-2-specific-types).

---

# §2 Register the type

**Single source of truth:** `packages/flint-js/src/core/type-registry.ts`

Add one entry to `TYPE_REGISTRY`. The record key is the **T2 type name**, which is also the string users pass in `semantic_types`.

```typescript
PercentageChange: {
    t0: 'Measure',
    t1: 'SignedMeasure',
    visEncodings: ['quantitative'],
    aggRole: 'signed-additive',
    domainShape: 'open',
    diverging: 'conditional',
    formatClass: 'percent',
    zeroBaseline: 'contextual',
    zeroPad: 0.05,
},
```

### `TypeRegistryEntry` fields

| Field | Values | Drives |
|---|---|---|
| `t0` | `T0Family` | Parser / encoding family |
| `t1` | `T1Category` | Mid-level rule selection |
| `visEncodings` | `VisCategory[]` (preference order) | Default Q/O/N/T encoding |
| `aggRole` | `additive`, `intensive`, `signed-additive`, `dimension`, `identifier` | `aggregationDefault` via `resolveAggregationDefault()` |
| `domainShape` | `open`, `bounded`, `fixed`, `cyclic` | Domain constraints, ticks, polar hints |
| `diverging` | `none`, `conditional`, `inherent` | Diverging color + midpoint |
| `formatClass` | `currency`, `percent`, `unit-suffix`, `integer`, `decimal`, `plain` | Axis/tooltip format via `resolveFormat()` |
| `zeroBaseline` | `meaningful`, `arbitrary`, `contextual`, `none` | Hint for `computeZeroDecision()` in Stage 4 |
| `zeroPad` | `number` (0–1 fraction) | Padding when axis does not include zero |

Query API: `getRegistryEntry()`, `isRegistered()`, `getRegisteredTypes()` in the same file.

**Not on the registry** (resolved elsewhere): explicit `pattern` strings, reversed axes, `colorScheme` names, and `stackable`. These come from `field-semantics.ts` / `resolve-semantics.ts`, which combine registry dimensions with data and channel context.

---

# §3 Sync constants and annotations

### `SemanticTypes` constants

Add a matching key to `packages/flint-js/src/core/semantic-types.ts` so call sites can reference the type safely:

```typescript
export const SemanticTypes = {
    // ...
    PercentageChange: 'PercentageChange',
} as const;
```

### Field-level metadata (optional)

Per-field details that are **not** intrinsic to the type belong on `SemanticAnnotation` (`field-semantics.ts`), not in `TYPE_REGISTRY`:

```typescript
interface SemanticAnnotation {
    semanticType: string;
    intrinsicDomain?: [number, number];  // e.g. Rating [1, 5]
    unit?: string;                        // e.g. USD, °C
    sortOrder?: string[];                 // custom ordinal order
}
```

Chart input accepts `Record<string, string | SemanticAnnotation>` as `semantic_types`.

---

# §4 Test and verify

1. **Gallery case** — add or extend a generator in `packages/flint-js/src/test-data/semantic-tests.ts` that uses the new type on a relevant channel.
2. **Register generator** — if this creates a new gallery page, wire the key in `packages/flint-js/src/test-data/index.ts` (`TEST_GENERATORS`) and optionally `gallery-tree.ts`.
3. **Run checks:**

```bash
npm run typecheck
npm run test
npm run site    # open Gallery → Semantic Context (or your new page)
```

Verify:

- Axis format matches `formatClass` (and `unit` when annotated)
- Aggregation follows `aggRole` when `autoAggregate` applies
- Zero baseline and reversal match type + mark (bar vs line)
- Diverging color appears only when `diverging` + data warrant it

---

# §5 Related

- [Semantic Type](/documentation/semantic-types) — T0/T1/T2 hierarchy, annotations, resolution rules
- [Architecture](/documentation/architecture) — where `resolveChannelSemantics` sits in the pipeline
- [API reference](/documentation/api-reference) — `semantic_types` on `ChartAssemblyInput`

# designlang v7.0 — Design Spec

**Date:** 2026-04-18
**Status:** Approved for implementation
**Author:** Manav Arya Singh

## Theme

*The design context layer for AI agents, across every platform.*

v7.0 turns designlang from a web-only token extractor into (a) the default MCP/agent context source for AI IDEs, (b) a real multi-platform design system output (web + iOS + Android + Flutter + WordPress), (c) a CSS auditor, not just an extractor.

## Scope — 10 features

### 1. MCP server
New command: `designlang mcp [--output-dir <path>]`. Launches a stdio MCP server built on `@modelcontextprotocol/sdk`. Exposes:
- **Resources:** `tokens://primitive`, `tokens://semantic`, `tokens://components`, `regions://map`, `health://score`.
- **Tools:** `search_tokens(query)`, `find_nearest_color(hex, level: AA|AAA)`, `get_region(name)`, `get_component(name)`, `list_failing_contrast_pairs()`.
- No live extraction tool (deferred to v7.1 with hosted backend).

### 2. Agent rules emitter
New flag: `--emit-agent-rules` (and on by default when `--full`). Writes:
- `.cursor/rules/designlang.mdc` — Cursor project rules referencing tokens.
- `.claude/skills/designlang/SKILL.md` — Claude Code skill folder with frontmatter.
- `CLAUDE.md.fragment` — append-ready fragment for root CLAUDE.md.
- `agents.md` — generic agent prompt.

All four files read from the same source-of-truth JSON.

### 3. DTCG strict mode + semantic layer + composite tokens
Rewrites `*-design-tokens.json` to W3C DTCG v1 format:
- Every leaf is `{ "$value": ..., "$type": "color|dimension|fontFamily|shadow|...", "$extensions": {...} }`.
- Two-layer structure: `primitive.*` (raw values) and `semantic.*` (alias references like `"{primitive.color.blue.500}"`).
- Composite types for `typography`, `shadow`, `border`, `gradient` (single object with family/size/weight/lineHeight, etc.).
- Auto-infers semantic roles from usage: `semantic.color.action.primary`, `semantic.color.surface.default`, `semantic.text.body`, `semantic.radius.control`, etc.
- **Default ON.** `--tokens-legacy` preserves pre-v7 shape. Breaking change — documented in CHANGELOG and migration guide.

### 4. Multi-platform emitters
New flag: `--platforms <csv>` (values: `web,ios,android,flutter,wordpress,all`; default `web`).
- **iOS (SwiftUI):** `*-ios.swift` with `Color.primaryAction`, `CGFloat` spacing/radius, `Font` registrations.
- **Android (Compose):** `*-colors.xml`, `*-dimens.xml`, `*-Theme.kt` with Compose `val`s.
- **Flutter (Dart):** `*-theme.dart` exporting a `ThemeData` + color/typography extensions.
- **WordPress:** `theme.json` (Gutenberg block theme tokens), `style.css` with CSS custom props, minimal `functions.php` + `index.php`/`templates/index.html` skeleton so output is a drop-in block theme.

All emitters consume the DTCG semantic layer, not primitives — they stay consistent.

### 5. Tech-stack + Tailwind fingerprint
New extractor `stack-fingerprint`:
- Detects framework from window globals, script URLs, meta tags, DOM signatures (React/Vue/Svelte/Next/Nuxt/Remix/Astro/Shopify/WooCommerce/Webflow/Framer).
- Detects CSS layer (Tailwind v3/v4, styled-components, CSS Modules, vanilla).
- Detects analytics, CDN, fonts host, A/B tools.
- When Tailwind is detected: scrapes class-name frequency, extracts utility classes in use, and emits `*-tailwind-diff.md` (what classes are used, config delta vs. default preset) instead of only a fresh `tailwind.config.js`.

### 6. CSS health audit
New extractor `css-health`:
- Runs Playwright `coverage.startCSSCoverage()` → reports unused bytes per stylesheet.
- Parses all stylesheets for specificity distribution, `!important` count, duplicate declarations, selector-per-rule averages, vendor-prefix and obsolete-property audit.
- Enumerates `@keyframes` with name/duration/easing/steps.
- Emits `*-css-health.json` and `*-css-health.md`.
- Adds three new dimensions to the design score: `cssHealth`, `animationCatalog`, `specificity`. Old score fields remain for backward compat.

### 7. A11y remediation suggestions
Extends a11y extractor:
- For each failing WCAG fg/bg pair, searches the extracted palette for the nearest color that passes AA (4.5:1) and AAA (7:1).
- Emits suggestions in `*-a11y.md` and as fixable entries in `*-design-language.md`.
- MCP tool `find_nearest_color(hex, level)` reuses this engine.

### 8. Semantic component segmentation
New extractor `semantic-regions`:
- Heuristic classifier using ARIA landmarks (`<nav>`, `<main>`, `<header>`, `<footer>`, `role=banner|contentinfo|complementary`), layout properties (sticky header, footer at page end), and class-name hints (`.hero`, `.pricing`, `.cta`).
- Labels detected regions: `nav`, `hero`, `features`, `pricing`, `testimonials`, `cta`, `footer`, `content`.
- Emits `*-regions.json` with bounds, computed styles, and region role.
- MCP tool `get_region(name)` returns the full region block.

### 9. Reusable component detection
New extractor `component-clusters`:
- For each DOM element matching button/card/input/badge/tag candidates, computes a structural hash (tag sequence + class pattern) + style vector (flattened computed-style array).
- Clusters by similarity (structural hash exact, style vector cosine > threshold).
- Replaces current "one example per component type" with `{ component, instanceCount, variants: [...] }`.
- Markdown output shows "Button — 24 instances, 2 variants (primary, ghost)" with CSS for each.

### 10. WordPress theme export
Covered under Feature 4; called out separately because it is a full emitter with file-tree skeleton, not only tokens.

## Architecture changes

### New modules
- `src/extractors/stack-fingerprint.js`
- `src/extractors/css-health.js`
- `src/extractors/semantic-regions.js`
- `src/extractors/component-clusters.js`
- `src/extractors/a11y-remediation.js` (or extend existing a11y)
- `src/formatters/dtcg-tokens.js` (replaces `design-tokens.js` with legacy fallback)
- `src/formatters/ios-swiftui.js`
- `src/formatters/android-compose.js`
- `src/formatters/flutter-dart.js`
- `src/formatters/wordpress-theme.js`
- `src/formatters/agent-rules.js`
- `src/mcp/server.js` + `src/mcp/resources.js` + `src/mcp/tools.js`

### New dependencies
- `@modelcontextprotocol/sdk` — for MCP server.
- No other additions.

### CLI surface
```
designlang <url> [...existing flags]
  --platforms <csv>       web,ios,android,flutter,wordpress,all (default: web)
  --emit-agent-rules      Emit Cursor/Claude Code/generic agent rules
  --tokens-legacy         Keep pre-v7 token JSON shape

designlang mcp [--output-dir <path>]   # NEW: launch MCP server
```

All existing commands (`apply`, `clone`, `score`, `watch`, `diff`, `brands`, `sync`, `history`) unchanged.

### Backward compatibility
- Base extraction stays — same file names, same top-level keys.
- **Breaking:** token JSON shape changes to DTCG. Mitigated by `--tokens-legacy`, loud CHANGELOG, migration section in README.
- **Additive:** score JSON gains new fields; existing fields preserved.
- **Additive:** new files only appear with opt-in flags (`--platforms`, `--emit-agent-rules`).

## Testing

- Unit tests per extractor module using fixture HTML (existing pattern in `tests/`).
- Integration test: run full extraction on a local fixture site, snapshot each output file.
- DTCG output validated against the W3C DTCG JSON schema (vendored).
- Multi-platform emitters: golden-file tests (check generated Swift/Kotlin/Dart/theme.json against known-good outputs).
- MCP server: spin up server, run a handful of resource/tool requests over the MCP test harness, assert responses.

## Release plan

1. Implement features in dependency order (see writing-plans phase).
2. All tests pass.
3. Update README with new sections: MCP, agent rules, multi-platform, CSS health, WordPress.
4. Write CHANGELOG.md with breaking-change callout on DTCG + migration snippet.
5. Bump `package.json` version `6.0.0` → `7.0.0`.
6. `npm publish` + `git tag v7.0.0 && git push --tags`.
7. Website update — deferred to Wave 2.

## Out of scope (deferred to v7.1+)

- Bidirectional Figma Variables sync.
- Full JSX/Vue/Svelte component codegen (needs Mitosis-style IR or LLM).
- Versioned auto-published npm token package with changesets.
- Hosted shareable reports (needs backend).
- Hosted "Try it free" web extraction (Wave 2).
- CMS content-model extraction.
- Storybook + Chromatic integration.
- Live clone-to-editable canvas.

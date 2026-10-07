# designlang v7.1 — Designer Toolkit

**Date:** 2026-04-19
**Status:** Approved for implementation

## Theme

*From extractor to designer's toolkit.* v7.0 shipped the full extraction surface. v7.1 makes the output composable, auditable, and complete — pull one component at a time, get every brand asset alongside the tokens, drop into any stack (Tailwind v4, Emotion, Stitches, Vanilla Extract, Panda), and fail your CI when production drifts from your design system.

## Scope (7 features)

### 1. Single-component extraction
New flag: `designlang <url> --component <css-selector>`.
- Playwright walks to the matched element, captures its own computed styles + its children's styles + its bounding box + its text content.
- Emits a tiny extraction: `*-component.md` (a specimen-style card), `*-component.json` (the DTCG subset actually used by this component), `*-component.tsx` / `*-component.vue` / `*-component.svelte` based on `--framework` (or all three by default).
- `--component` can be combined with `--platforms all` and `--emit-agent-rules`.

### 2. Asset / brand-kit extraction
New flag: `designlang <url> --assets` (also implied by `--full`).
- Crawler enumerates every `<img>`, `<picture>`, `<source>`, `<svg>` (reuse existing icons work), `<link rel="icon">`, `<meta property="og:image">`, and CSS `background-image` URLs.
- Downloads each asset with a timeout and size cap (50MB total per extraction).
- Classifies: `logo`, `icon`, `illustration`, `photo`, `hero`, `og`, `favicon`, `avatar`, `screenshot`, `other`.
- Emits to `<out>/assets/<kind>/<original-filename-or-hash.ext>` plus `assets-manifest.json` with the type, source URL, dimensions, byte size, and an `srcset`-style variant list for `<picture>` elements.
- Size-aware: don't download a 20MB hero if it exceeds a per-asset cap (default 5MB). Log skipped assets in the manifest with a `skipped: reason` field.

### 3. Illustration detection (folded into #2)
- SVGs ≥ 200px or with >30 path elements → classified `illustration`, not `icon`.
- Inline-SVG illustrations captured alongside external file references.
- Raster illustrations (transparent PNG with flat-color regions) classified separately from photos via dominant-color entropy heuristic.

### 4. Tailwind v4 `@theme` formatter
New output file `<prefix>-tailwind.css` (separate from the existing `*-tailwind.config.js`, which stays for v3 users).
- Uses the Tailwind v4 `@theme { … }` block syntax inside a `@import "tailwindcss"` wrapper.
- Maps DTCG semantic tokens → Tailwind v4 CSS custom properties.
- Respects `--tokens-legacy` (v4 file still emitted but from primitive-only JSON).

### 5. CSS-in-JS emitters
Four new formatters under `src/formatters/css-in-js/`:
- `emotion.js` → `<prefix>-emotion.theme.ts`
- `stitches.js` → `<prefix>-stitches.config.ts`
- `vanilla-extract.js` → `<prefix>-vanilla.css.ts`
- `panda.js` → `<prefix>-panda.config.ts`

Selectable via new flag: `--framework emotion|stitches|vanilla-extract|panda|tailwind4`. Multi-select: `--framework emotion,stitches`. Default behavior unchanged: emit React theme + shadcn theme.

### 6. Drift detection + GitHub Action
New command: `designlang drift <url> <tokens-path> [--out <report-path>] [--fail-on <category>] [--tolerance <n>]`.
- Extracts from `<url>`, loads DTCG JSON at `<tokens-path>`, walks both trees, and produces a report:
  - `added` tokens (in extraction, not in file)
  - `removed` (in file, not in extraction)
  - `changed` (path matches, `$value` differs beyond tolerance)
- Tolerance: colors use ΔE threshold (default 3), dimensions use px delta (default 1), others exact match.
- `--fail-on color|dimension|typography|all` controls exit code (default exits 0 for a report-only run; exit 1 when any matching drift found with `--fail-on`).
- Emits `drift-report.md` + `drift-report.json`.
- **GitHub Action:** new `.github/workflows/designlang-drift.yml` template committed to this repo under `templates/github-action/designlang-drift.yml` with a README snippet. Runs on PR + daily cron, posts the report as a PR comment when drift is detected.

### 7. Release
- Bump to `7.1.0`, CHANGELOG entry, README updates, npm publish, git tag.

## Non-goals (deferred to v7.2+)

- **Remix Mode** / interactive web editor — substantial Next.js work; needs its own spec.
- **Figma plugin**, **Chrome extension**, **VS Code extension** — each is a separate package with its own store/review cycle.
- **Brand-voice extraction** (tone, reading level) — out of scope for a token release.
- **Token marketplace / shared workspaces** — hosted SaaS territory.

## Architecture

### New files
- `src/extractors/component.js` — selector-scoped extraction
- `src/extractors/assets.js` — classifier + downloader for images and illustrations
- `src/formatters/tailwind-v4.js`
- `src/formatters/css-in-js/emotion.js`
- `src/formatters/css-in-js/stitches.js`
- `src/formatters/css-in-js/vanilla-extract.js`
- `src/formatters/css-in-js/panda.js`
- `src/formatters/component-snippet.js` — emits JSX / Vue / Svelte / HTML snippet from a component extraction
- `src/formatters/drift.js` — produces drift-report.md + drift-report.json
- `src/drift.js` — orchestrator for the `drift` subcommand
- `templates/github-action/designlang-drift.yml`
- `templates/github-action/README.md`

### Modified files
- `src/crawler.js` — add `fetchAssets()` with per-asset timeout + cap; add `page.$(selector).then(el => el.evaluate(...))` path for `--component`
- `src/index.js` — wire new extractors + output files
- `bin/design-extract.js` — new flags + `drift` subcommand
- `src/config.js` — thread new options (`component`, `assets`, `framework`, driftTolerance)
- `tests/extractors.test.js` + `tests/formatters.test.js` — new tests per extractor/formatter
- `package.json` — version bump, potentially add `sharp` for optional raster resize (deferred decision — only if it stays zero-runtime-cost)
- `README.md`
- `CHANGELOG.md`

### Dependencies
- No new runtime deps. Image downloads use Node 20's native `fetch`. Classifier is heuristic only (no ML).

### Security / safety
- Asset downloader respects the same URL-safety layer as the website API (no private IPs, http(s) only, byte cap).
- Same-origin preferred; cross-origin assets downloaded with an `Accept` header and a 10s timeout each.

## Tests

- Unit tests per extractor and formatter, snapshot-style for golden outputs.
- Integration smoke: `designlang <url> --component "header nav" --assets --framework emotion,stitches,vanilla-extract,panda,tailwind4` produces all expected files.
- Drift integration test: run against a fixture tokens file and a live URL, confirm report contents.

## Release plan

1. Implement via subagents in 3 parallel chunks (component+assets, emitters, drift+action).
2. Tests green.
3. README + CHANGELOG.
4. Version bump → PR → merge → npm publish → tag.

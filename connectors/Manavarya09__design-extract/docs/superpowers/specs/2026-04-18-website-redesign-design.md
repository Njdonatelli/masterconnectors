# designlang website redesign — Wave 2

**Date:** 2026-04-18
**Status:** Approved for implementation
**Direction:** Live Design DNA — the site embodies what designlang does.

## Non-negotiables (from user)

- No "AI slop" aesthetic. No purple/blue gradients. No glassmorphism. No floating hero cards.
- **No emoji. No icon libraries** (Lucide, Heroicons, Phosphor). Iconography only as intent-drawn inline SVG, numerals, or letterforms.
- No Framer Motion bloat, no fade-up-on-every-element scroll theatrics.
- Copy must be earned, not templated.
- Designer voice visible — marginalia, footnotes, document-feel.

## Visual system

**Base:** warm paper `#F3F1EA`, ink `#0A0908`, accent `#FF4800` (used once per screen, maximum).
**Grays (warm):** `#D8D3C5`, `#8B8778`, `#403C34`.
**Type:** Fraunces (display, optical 9pt, massive sizes), Instrument Sans (body), JetBrains Mono (mono/tokens).
**Grid:** 12-col, 24px gutters, deliberately broken by marginalia and side notes.
**Rules:** 1px solid ink hairlines everywhere (document feel), no soft dividers.
**Shadow:** one hard offset shadow (`6px 6px 0 #FF4800`) on the primary CTA only.
**Dark mode:** deferred. Paper-first matches design-system/archival feel.
**Motion:** prefers-reduced-motion strict. All motion is content-matched (see §Signature Interactions).

## Page structure

Single-page scroll. Numbered sections like a monograph: `§00`…`§09`.

- §00 `HERO` — URL input + live extraction stream; tokens paint on screen as they compute.
- §01 `DTCG BROWSER` — interactive alias resolver. Click a semantic token, the line flies to its primitive.
- §02 `MCP` — split: Cursor/Claude Code rule panel on left, real terminal transcript on right.
- §03 `MULTI-PLATFORM` — tabs Web / iOS / Android / Flutter / WordPress; same token in 5 languages.
- §04 `CSS HEALTH` — big numerals (unused %, `!important` count, duplicates) set against real specificity plot.
- §05 `A11Y REMEDIATION` — before/after contrast slider with live ratio.
- §06 `REGIONS + COMPONENTS` — annotated screenshot; button cluster animates into variants.
- §07 `FEATURED SPECIMENS` — stripe / vercel / linear / github / figma / apple; each extracted and displayed like a museum specimen. Page accent shifts as you scroll between them.
- §08 `COMPARISON` — transparent, opinionated table vs. v0, Builder.io, Style Dictionary, Subframe, Project Wallace.
- §09 `INSTALL & FOOTER` — `npx designlang`, MCP config, Cursor rule install, GitHub/npm/Discussions/sponsor.

## Signature interactions (motion only where content-matched)

1. **Hero stream** — user submits URL, server streams back tokens in extraction order; swatches paint from left to right as server events arrive.
2. **DTCG alias flight** — click `{primitive.color.brand.primary}` string, an SVG line animates from the semantic token to the primitive, primitive highlights, hex resolves inline.
3. **Accent shift scroll** — as the Featured Specimens section scrolls, page accent CSS var transitions to each specimen's extracted primary.
4. **A11y slider** — handle drag shows contrast ratio updating live above the color pair.
5. **MCP terminal transcript** — real JSON-RPC lines, typed at realistic speed, showing `search_tokens` → result.
6. **Component cluster unfold** — a single button card unfolds into its detected variants on scroll-into-view.

No other motion.

## Backend

**Existing:** `/api/extract` route using `@sparticuz/chromium` + `playwright-core` + designlang `extractDesignLanguage`.

**Changes required:**

1. **v7.0 output parity** — currently the API returns v6 shape. Add DTCG tokens, agent rules, MCP companion JSON, multi-platform outputs.
2. **Streaming response** — the extraction produces tokens progressively; stream them over an HTTP stream (Next.js 16 streaming response) so the hero demo paints live. If extraction is atomic today (single `page.evaluate`), we stream the *stages*: crawl → colors → typography → spacing → components → a11y → done.
3. **Rate limiting** — Vercel Edge Config or in-memory map keyed by IP. 3 extractions per IP per day for anonymous, soft 429 with helpful copy. No login.
4. **URL validation** — reject `localhost`, `127.x`, `169.254.x`, `10.x`, `172.16–31.x`, `192.168.x`, `file://`, non-http(s). Reject URLs whose DNS resolves to private ranges.
5. **Timeout cap** — hard 45s; abort Playwright if exceeded.
6. **Caching** — cache extraction result by URL in Vercel Blob for 24h. Collision: same URL within 24h returns cached zip + a small "cached" annotation.
7. **Bot detection** — Vercel BotID (free, platform-native).
8. **Output:** downloadable `.zip` of all generated files (same set the CLI would produce for `--platforms all --emit-agent-rules`) plus a JSON summary for the on-screen preview.

**New/changed files:**
- `website/app/api/extract/route.js` — streaming + rate limit + caching + v7.0 outputs
- `website/lib/rate-limit.js` (new)
- `website/lib/url-safety.js` (new)
- `website/lib/cache.js` (new, Vercel Blob-backed)

## Frontend components (new)

Kept flat in `website/app/components/`. Each is a self-contained section:

- `Hero.js` — URL input + live stream renderer
- `TokenBrowser.js` — DTCG alias resolver
- `McpSection.js` — split editor + terminal
- `PlatformTabs.js` — multi-platform code viewer
- `CssHealth.js` — numerals + specificity plot (hand-drawn SVG scatter)
- `A11ySlider.js` — contrast before/after
- `RegionsComponents.js` — annotated image + cluster unfold
- `Specimens.js` — featured site grid; orchestrates accent shift
- `Comparison.js` — opinionated feature matrix
- `InstallFooter.js` — closing section
- `Marginalia.js` — shared side-column component for footnotes and command labels
- `Rule.js` — 1px hairline divider with section label

New lib:
- `website/lib/token-helpers.js` — DTCG alias resolution shared with components
- `website/lib/specimens.json` — pre-extracted data for the featured section (generated at build time from the CLI so specimens are real)

## Deferred (explicit non-goals for Wave 2)

- Login / user accounts / saved extractions
- Paid tiers
- Dark mode
- Blog / changelog page
- i18n
- Sharable `/x/<slug>` permalinks (nice-to-have but not Wave 2)

## Test / verification plan

- Lighthouse: LCP ≤ 2.0s on the hero at 3G-Fast, CLS 0, accessibility ≥ 95.
- `prefers-reduced-motion: reduce` — verify all motion stops or substitutes with non-motion reveal.
- Keyboard navigation through every interactive element.
- Extractor end-to-end: submit real URL, receive streamed tokens, download zip, verify zip contains v7.0 shape.
- Rate limit: 4th request from same IP returns 429 with copy.
- URL safety: localhost, private IPs, `file://` all rejected with 400.

## Implementation chunks (PR per chunk)

Each chunk is one PR. Merge before starting the next, same pattern as v7.0 release.

- **PR A: Foundation** — fonts, base CSS, grid primitives, `Rule`, `Marginalia`, new `globals.css`, `layout.js`, clean `page.js` scaffold.
- **PR B: Hero + streaming extraction API** — hero component, API streaming, URL safety, rate limit, basic Blob cache.
- **PR C: Core showcase sections** — DTCG browser, MCP section, multi-platform tabs.
- **PR D: Analytics sections** — CSS health, a11y slider, regions + components.
- **PR E: Specimens + comparison + install + footer + deploy** — pre-extract data at build time, accent-shift scroll, comparison table, final polish, Vercel deploy.

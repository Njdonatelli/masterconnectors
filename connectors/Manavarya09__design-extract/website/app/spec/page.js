export const metadata = {
  title: 'DESIGN.md spec — designlang',
  description:
    'The DESIGN.md format spec — single-file, 8-section, YAML front matter agent-native design system artifact.',
  alternates: { canonical: 'https://designlang.app/spec' },
  openGraph: { title: 'DESIGN.md — open spec', description: 'The agent-native design-system artifact, formalized.' },
};

export default function Spec() {
  return (
    <main>
      <section className="section" style={{ paddingTop: 64, paddingBottom: 32 }}>
        <div className="wrap-narrow">
          <p className="eyebrow">spec · v0.2</p>
          <h1 className="h1" style={{ fontSize: 'clamp(40px, 5.5vw, 64px)' }}>DESIGN.md</h1>
          <p className="lede" style={{ marginTop: 16 }}>
            A single-file, eight-section, YAML-front-matter design-system artifact.
            Captures a website&rsquo;s design system in a form an LLM can read and an engineer can edit.
            The design counterpart to AGENTS.md.
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap-narrow">
          <article className="prose">
            <h2>Structure</h2>
            <p>A valid <code>DESIGN.md</code> has two layers:</p>
            <ol>
              <li><strong>YAML front matter</strong> — the machine-readable token snapshot (colours, typography, spacing, radii, shadows).</li>
              <li><strong>Markdown body</strong> — up to eight canonical sections, in this order. Any may be omitted if not relevant.</li>
            </ol>

            <h3>The eight canonical sections</h3>
            <ol>
              <li><strong>Overview</strong> — one-paragraph design rationale plus page intent and material language.</li>
              <li><strong>Colors</strong> — palette table (role · hex · usage), neutrals, total unique count.</li>
              <li><strong>Typography</strong> — families, weights, body size, heading scale.</li>
              <li><strong>Layout</strong> — spacing base + scale, breakpoints, grid/flex primitive counts.</li>
              <li><strong>Elevation and Depth</strong> — shadow scale and z-index layers.</li>
              <li><strong>Shapes</strong> — border-radius scale.</li>
              <li><strong>Components</strong> — detected patterns and anatomy table (kind · variants · sizes · instances).</li>
              <li><strong>Do&rsquo;s and Don&rsquo;ts</strong> — actionable directional guidance from voice + lint.</li>
            </ol>
            <p>Sections may be added (e.g. Motion, Voice, Imagery) but should appear after the eight canonical ones.</p>

            <h2>Front-matter schema</h2>
            <pre>{`site:           string        # canonical name
url:            string        # source URL (preferred)
generated_at:   ISO 8601      # UTC timestamp
generator:      "tool@vX.Y"   # tool identifier
intent:         string        # landing | pricing | docs | blog | product | …
material:       string        # flat | brutalist | glass | soft-ui | material-you | …
library:        string?       # shadcn/ui | radix | mui | chakra | tailwind-ui | …
tokens:
  colors:
    primary:    "#hex"
    secondary?: "#hex"
    accent?:    "#hex"
    background: "#hex"
    foreground: "#hex"
  typography:
    sans:       string
    mono?:      string
    base:       integer       # px
  spacing:
    base?:      integer       # px
    scale:      integer[]
  radii?:
    xs|sm|md|lg|xl|full: integer  # px
  shadows?:
    sm|md|lg|xl: string       # raw box-shadow value`}</pre>

            <h2>Reference implementation</h2>
            <p>
              designlang ships a reference emitter at{' '}
              <a href="https://github.com/Manavarya09/design-extract/blob/main/src/formatters/design-md.js">src/formatters/design-md.js</a>.
              Generate a sample with:
            </p>
            <pre>{`npx designlang stripe.com    # writes stripe-com-DESIGN.md`}</pre>

            <h2>The Verified badge</h2>
            <p>
              Sites that publish their own DESIGN.md at <code>/DESIGN.md</code> may embed the SVG badge —
              a one-shot signal to crawlers, AI agents, and design-system tooling that the spec is honoured.
            </p>
            <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '14px 0' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/badge.svg" alt="DESIGN.md verified" width={140} height={28} />
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                &lt;a href=&quot;https://designlang.app/spec&quot;&gt;&lt;img src=&quot;https://designlang.app/badge.svg&quot;/&gt;&lt;/a&gt;
              </code>
            </div>

            <h2>Compatibility</h2>
            <p>
              The eight-section structure follows the convention pioneered at <a href="https://www.design-extractor.com" rel="nofollow noopener">design-extractor.com</a>.
              designlang extends the front matter with a semantic layer (<code>intent</code>, <code>material</code>, <code>library</code>) so
              downstream tools have richer ground truth without sacrificing single-file portability.
            </p>

            <h2>Licence</h2>
            <p>The spec is published under <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a> — copy, fork, extend, embed.</p>
          </article>
        </div>
      </section>
    </main>
  );
}

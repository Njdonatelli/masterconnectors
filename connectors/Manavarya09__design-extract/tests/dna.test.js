import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { designVector, FEATURE_ORDER } from '../src/dna/vector.js';

// A realistic, fully-populated design object in the shape src/index.js assembles.
const linearish = {
  meta: { url: 'https://linear.app' },
  colors: {
    primary: { hex: '#5e6ad2', hsl: { h: 234, s: 0.55, l: 0.6 } },
    accent: { hex: '#7c8cf8', hsl: { h: 232, s: 0.89, l: 0.73 } },
    neutrals: [{ hex: '#08090a', hsl: { h: 210, s: 0.03, l: 0.03 } }],
    backgrounds: ['#08090a', '#141516'],
    all: [
      { hex: '#5e6ad2', hsl: { h: 234, s: 0.55, l: 0.6 }, count: 40 },
      { hex: '#08090a', hsl: { h: 210, s: 0.03, l: 0.03 }, count: 200 },
    ],
  },
  typography: {
    families: [{ name: 'Inter', usage: 'all' }],
    scale: [{ size: 13, lineHeight: 1.5 }, { size: 16, lineHeight: 1.6 }, { size: 21, lineHeight: 1.4 }, { size: 56, lineHeight: 1.1 }],
    weights: [{ weight: 400 }, { weight: 510 }, { weight: 680 }],
    body: { size: 16, lineHeight: 1.6 },
  },
  spacing: { base: 8, scale: [8, 16, 24, 32, 48, 64], raw: [8, 16, 24, 32, 48, 64] },
  borders: { radii: [{ value: 4 }, { value: 8 }, { value: 12 }], widths: [1], styles: ['solid'] },
  shadows: { values: [{ blur: 16, spread: 0, offsetX: 0, offsetY: 4, visualWeight: 20, label: 'lg' }] },
  motion: {
    durations: [{ ms: 120 }, { ms: 250 }],
    easings: [{ family: 'ease-out', count: 30 }, { family: 'ease-in-out', count: 4 }],
    springs: [],
    scrollLinked: { present: false, signals: [] },
  },
};

describe('designVector — contract', () => {
  it('emits one value per feature, in the frozen FEATURE_ORDER', () => {
    const v = designVector(linearish);
    assert.equal(v.values.length, FEATURE_ORDER.length);
    assert.deepEqual(v.order, FEATURE_ORDER);
  });

  it('keeps every value inside 0..1, or null when the input is missing', () => {
    const v = designVector(linearish);
    for (let i = 0; i < v.values.length; i++) {
      const x = v.values[i];
      if (x === null) continue;
      assert.ok(Number.isFinite(x), `${FEATURE_ORDER[i]} = ${x} is not finite`);
      assert.ok(x >= 0 && x <= 1, `${FEATURE_ORDER[i]} = ${x} is outside 0..1`);
    }
  });

  it('is deterministic — the same design yields an identical vector', () => {
    assert.deepEqual(designVector(linearish).values, designVector(linearish).values);
  });

  it('degrades to nulls instead of throwing on an empty design', () => {
    const v = designVector({});
    assert.equal(v.values.length, FEATURE_ORDER.length);
    assert.ok(v.values.every(x => x === null));
  });
});

import { designDistance, nearest } from '../src/dna/distance.js';
import { AXES } from '../src/dna/vector.js';

// Same family as `linearish`: dark, low-chroma, tight radii, quick ease-out.
const vercelish = {
  meta: { url: 'https://vercel.com' },
  colors: {
    primary: { hex: '#0070f3', hsl: { h: 212, s: 1, l: 0.48 } },
    neutrals: [{ hex: '#0a0a0a', hsl: { h: 0, s: 0, l: 0.04 } }],
    backgrounds: ['#000000', '#111111'],
    all: [
      { hex: '#0070f3', hsl: { h: 212, s: 1, l: 0.48 }, count: 30 },
      { hex: '#0a0a0a', hsl: { h: 0, s: 0, l: 0.04 }, count: 220 },
    ],
  },
  typography: {
    families: [{ name: 'Geist', usage: 'all' }],
    scale: [{ size: 14, lineHeight: 1.5 }, { size: 16, lineHeight: 1.6 }, { size: 24, lineHeight: 1.3 }, { size: 60, lineHeight: 1.1 }],
    weights: [{ weight: 400 }, { weight: 600 }],
    body: { size: 16, lineHeight: 1.6 },
  },
  spacing: { base: 8, scale: [8, 16, 24, 32, 48, 64] },
  borders: { radii: [{ value: 5 }, { value: 8 }, { value: 12 }], widths: [1], styles: ['solid'] },
  shadows: { values: [{ blur: 12, spread: 0, offsetX: 0, offsetY: 4, visualWeight: 16, label: 'md' }] },
  motion: {
    durations: [{ ms: 150 }, { ms: 200 }],
    easings: [{ family: 'ease-out', count: 24 }, { family: 'ease-in-out', count: 3 }],
    springs: [],
    scrollLinked: { present: false, signals: [] },
  },
};

// Deliberately the opposite pole: bright, light, pill-shaped, slow bouncy
// motion, huge display contrast, many families.
const playful = {
  meta: { url: 'https://example-playful.com' },
  colors: {
    primary: { hex: '#ff2d55', hsl: { h: 348, s: 1, l: 0.59 } },
    accent: { hex: '#ffd60a', hsl: { h: 50, s: 1, l: 0.52 } },
    neutrals: [{ hex: '#8a8f98', hsl: { h: 215, s: 0.05, l: 0.57 } }],
    backgrounds: ['#fffdf7', '#ffe9a8', '#ffffff'],
    all: [
      { hex: '#ff2d55', hsl: { h: 348, s: 1, l: 0.59 }, count: 60 },
      { hex: '#ffd60a', hsl: { h: 50, s: 1, l: 0.52 }, count: 50 },
      { hex: '#34c759', hsl: { h: 135, s: 0.6, l: 0.49 }, count: 40 },
    ],
  },
  typography: {
    families: [{ name: 'Fraunces' }, { name: 'Nunito' }, { name: 'Caveat' }],
    scale: [{ size: 18, lineHeight: 1.8 }, { size: 32, lineHeight: 1.4 }, { size: 96, lineHeight: 1 }],
    weights: [{ weight: 300 }, { weight: 900 }],
    body: { size: 18, lineHeight: 1.8 },
  },
  spacing: { base: 6, scale: [6, 14, 22, 39, 71] },
  borders: { radii: [{ value: 999 }, { value: 32 }, { value: 48 }], widths: [3], styles: ['solid'] },
  shadows: { values: [{ blur: 0, spread: 0, offsetX: 8, offsetY: 8, visualWeight: 11, label: 'md' }] },
  motion: {
    durations: [{ ms: 600 }, { ms: 900 }],
    easings: [{ family: 'linear', count: 20 }],
    springs: [{ raw: 'spring(1 100 10 0)' }, { raw: 'spring(1 80 8 0)' }, { raw: 'spring(1 60 6 0)' }],
    scrollLinked: { present: true, signals: ['scroll-timeline'] },
  },
};

describe('designDistance', () => {
  it('scores a design against itself as zero', () => {
    const v = designVector(linearish);
    assert.equal(designDistance(v, v).overall, 0);
  });

  it('is symmetric', () => {
    const a = designVector(linearish), b = designVector(playful);
    assert.equal(designDistance(a, b).overall, designDistance(b, a).overall);
  });

  it('reports a distance per axis, not one opaque number', () => {
    const d = designDistance(designVector(linearish), designVector(playful));
    assert.deepEqual(Object.keys(d.axes).sort(), [...AXES].sort());
    for (const axis of AXES) {
      assert.ok(d.axes[axis].distance >= 0 && d.axes[axis].distance <= 1);
      assert.ok(d.axes[axis].compared > 0);
    }
  });

  it('places two dark minimal systems nearer than either is to a playful one', () => {
    const lin = designVector(linearish), ver = designVector(vercelish), play = designVector(playful);
    const near = designDistance(lin, ver).overall;
    assert.ok(near < designDistance(lin, play).overall, `linear~vercel ${near} should beat linear~playful`);
    assert.ok(near < designDistance(ver, play).overall, `linear~vercel ${near} should beat vercel~playful`);
  });

  it('skips features the other side is missing rather than inventing a value', () => {
    const full = designVector(linearish);
    const noMotion = designVector({ ...linearish, motion: undefined });
    const d = designDistance(full, noMotion);
    assert.equal(d.axes.motion.compared, 0);
    assert.equal(d.axes.motion.distance, null);
    assert.ok(d.compared < full.values.length);
  });

  it('refuses to score two designs with nothing in common', () => {
    const d = designDistance(designVector({}), designVector({}));
    assert.equal(d.overall, null);
    assert.equal(d.comparable, false);
  });
});

describe('nearest', () => {
  it('ranks the corpus by distance, closest first', () => {
    const corpus = [designVector(playful), designVector(vercelish)];
    const ranked = nearest(designVector(linearish), corpus);
    assert.equal(ranked[0].url, 'https://vercel.com');
    assert.ok(ranked[0].distance < ranked[1].distance);
  });

  it('never ranks a design against itself', () => {
    const lin = designVector(linearish);
    const ranked = nearest(lin, [lin, designVector(vercelish)]);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].url, 'https://vercel.com');
  });
});

import { buildCorpus, percentiles } from '../src/dna/corpus.js';

// Small edits a re-extraction might plausibly produce — a stray colour, a
// couple of px, one extra duration — must not move a design in the space.
const linearishReextracted = {
  ...linearish,
  colors: {
    ...linearish.colors,
    all: [...linearish.colors.all, { hex: '#5f6bd3', hsl: { h: 234, s: 0.54, l: 0.61 }, count: 3 }],
  },
  typography: {
    ...linearish.typography,
    scale: [{ size: 13, lineHeight: 1.5 }, { size: 16, lineHeight: 1.6 }, { size: 22, lineHeight: 1.4 }, { size: 56, lineHeight: 1.1 }],
  },
  motion: { ...linearish.motion, durations: [{ ms: 120 }, { ms: 240 }] },
};

describe('vector robustness', () => {
  it('barely moves under extraction noise, but moves a lot under a real restyle', () => {
    const base = designVector(linearish);
    const noise = designDistance(base, designVector(linearishReextracted)).overall;
    const restyle = designDistance(base, designVector(playful)).overall;

    assert.ok(noise < 0.02, `noise moved the vector ${noise}, expected < 0.02`);
    assert.ok(restyle > 10 * noise, `restyle ${restyle} should dwarf noise ${noise}`);
  });
});

describe('percentiles', () => {
  const corpus = buildCorpus([designVector(linearish), designVector(vercelish), designVector(playful)]);

  it('places a design below everything in the corpus near 0', () => {
    const grey = designVector({
      ...linearish,
      colors: { ...linearish.colors, all: [{ hex: '#808080', hsl: { h: 0, s: 0, l: 0.5 }, count: 10 }] },
    });
    const p = percentiles(grey, corpus);
    assert.ok(p.features['color.chromaMean'] <= 0.34, `expected a low chroma percentile, got ${p.features['color.chromaMean']}`);
  });

  it('places a design above everything in the corpus near 1', () => {
    const vivid = designVector({
      ...linearish,
      colors: {
        ...linearish.colors,
        all: [
          { hex: '#ff0000', hsl: { h: 0, s: 1, l: 0.5 }, count: 10 },
          { hex: '#00ff00', hsl: { h: 120, s: 1, l: 0.5 }, count: 10 },
        ],
      },
    });
    const p = percentiles(vivid, corpus);
    assert.ok(p.features['color.chromaMean'] >= 0.66, `expected a high chroma percentile, got ${p.features['color.chromaMean']}`);
  });

  it('reports a percentile per axis as well as per feature', () => {
    const p = percentiles(designVector(linearish), corpus);
    for (const axis of AXES) assert.ok(p.axes[axis] >= 0 && p.axes[axis] <= 1);
  });

  it('leaves features the design never measured as null', () => {
    const p = percentiles(designVector({ ...linearish, motion: undefined }), corpus);
    assert.equal(p.features['motion.durationMedian'], null);
  });

  it('refuses a corpus built for a different vector version', () => {
    assert.throws(
      () => percentiles(designVector(linearish), { ...corpus, version: 999 }),
      /version/i,
    );
  });
});

import { formatDnaMarkdown } from '../src/dna/report.js';
import { outliers } from '../src/dna/corpus.js';

describe('formatDnaMarkdown', () => {
  const corpus = buildCorpus([designVector(linearish), designVector(vercelish), designVector(playful)]);
  const subject = designVector(vercelish);
  const report = () => formatDnaMarkdown({
    vector: subject,
    corpus,
    neighbours: nearest(subject, corpus.entries.map(e => ({ ...e, version: subject.version }))),
    percentiles: percentiles(subject, corpus),
    outliers: outliers(subject, corpus),
  });

  it('names each nearest neighbour with its distance', () => {
    const md = report();
    assert.match(md, /linear\.app/);
    assert.match(md, /0\.\d{2}/);
  });

  it('reports a percentile line for every axis', () => {
    const md = report();
    for (const axis of AXES) assert.match(md, new RegExp(axis, 'i'));
  });

  it('warns when the vector was built from patchy extraction', () => {
    const patchy = designVector({ colors: linearish.colors });
    const md = formatDnaMarkdown({
      vector: patchy,
      corpus,
      neighbours: [],
      percentiles: percentiles(patchy, corpus),
      outliers: outliers(patchy, corpus),
    });
    assert.match(md, /coverage/i);
  });

  it('stays quiet about coverage when the extraction was complete', () => {
    assert.ok(subject.coverage === 1, `fixture should be fully covered, got ${subject.coverage}`);
    assert.doesNotMatch(report(), /incomplete/i);
  });
});

import { loadCorpus, saveCorpus } from '../src/dna/store.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('corpus store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dna-store-'));

  it('round-trips a corpus through disk unchanged', () => {
    const corpus = buildCorpus([designVector(linearish), designVector(vercelish)]);
    const file = join(dir, 'corpus.json');
    saveCorpus(file, corpus);
    assert.deepEqual(loadCorpus(file), corpus);
  });

  it('returns null when there is no corpus file', () => {
    assert.equal(loadCorpus(join(dir, 'nope.json')), null);
  });

  it('refuses a corpus file written by an older vector version', () => {
    const file = join(dir, 'stale.json');
    writeFileSync(file, JSON.stringify({ version: 0, name: 'stale', size: 1, entries: [], columns: [] }));
    assert.throws(() => loadCorpus(file), /version/i);
  });
});

import { colorFeatures, typeFeatures } from '../src/dna/features.js';

// The real extractors emit HSL with s/l on a 0-100 scale (src/utils.js),
// font weights as CSS strings, and line-height as a computed CSS length.
// Features must read those shapes, not just the tidy ones.
describe('features — real extractor shapes', () => {
  it('reads saturation and lightness given on a 0-100 scale', () => {
    const f = colorFeatures({
      colors: {
        primary: { hex: '#635bff', hsl: { h: 243, s: 100, l: 68 } },
        neutrals: [{ hex: '#425466', hsl: { h: 210, s: 21, l: 33 } }],
        backgrounds: ['#ffffff'],
        all: [{ hex: '#635bff', hsl: { h: 243, s: 100, l: 68 }, count: 10 }],
      },
    });
    assert.ok(f.chromaMean <= 1, `chromaMean ${f.chromaMean} should be a 0..1 fraction`);
    assert.ok(f.neutralTemp <= 1, `neutralTemp ${f.neutralTemp} should be a 0..1 fraction`);
    assert.ok(f.accentDelta <= 1, `accentDelta ${f.accentDelta} should be a 0..1 fraction`);
  });

  it('reads font weights that arrive as CSS strings', () => {
    const f = typeFeatures({ typography: { weights: [{ weight: '400' }, { weight: '700' }] } });
    assert.equal(f.weightRange, 300);
  });

  it('converts a computed line-height in px into a ratio', () => {
    const f = typeFeatures({
      typography: {
        scale: [{ size: 16, lineHeight: '24px' }],
        body: { size: 16, lineHeight: '24px' },
      },
    });
    assert.equal(f.bodyLineHeight, 1.5);
  });

  it('treats a `normal` line-height as unmeasured rather than guessing', () => {
    const f = typeFeatures({
      typography: { scale: [{ size: 16, lineHeight: 'normal' }], body: { size: 16, lineHeight: 'normal' } },
    });
    assert.equal(f.bodyLineHeight, null);
  });
});

describe('formatDnaMarkdown — neighbour wording', () => {
  it('calls only the first neighbour the closest', () => {
    const corpus = buildCorpus([designVector(linearish), designVector(vercelish), designVector(playful)]);
    const subject = designVector(vercelish);
    const md = formatDnaMarkdown({
      vector: subject,
      corpus,
      neighbours: nearest(subject, corpus.entries),
      percentiles: percentiles(subject, corpus),
      outliers: outliers(subject, corpus),
    });
    assert.equal((md.match(/closest/gi) || []).length, 1);
  });
});

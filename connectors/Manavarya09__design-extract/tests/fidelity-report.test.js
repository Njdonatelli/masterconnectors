import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFidelityJson, formatFidelityMarkdown, formatFidelityCard,
} from '../src/formatters/fidelity-report.js';

const report = {
  host: 'stripe.com',
  url: 'https://stripe.com',
  generatedAt: '2026-06-22T00:00:00.000Z',
  overall: 88,
  grade: 'B',
  visual: 92,
  motion: 82,
  directives: [
    { priority: 'high', area: 'motion', aspect: 'springs', issue: 'original uses spring easing the clone is missing', fix: 'Use a spring/overshoot curve.' },
    { priority: 'medium', area: 'visual', aspect: 'shadow', issue: 'button uses 2 unmapped shadow values', fix: 'Extract shadow tokens.' },
  ],
  motionAspects: [
    { aspect: 'feel', score: 0.5, original: 'springy', clone: 'smooth' },
    { aspect: 'springs', score: 0, original: 1, clone: 0 },
    { aspect: 'scrollLinked', score: 1, original: true, clone: true },
  ],
};

describe('formatFidelityJson', () => {
  it('round-trips the report as pretty JSON', () => {
    const out = formatFidelityJson(report);
    const parsed = JSON.parse(out);
    assert.equal(parsed.overall, 88);
    assert.equal(parsed.directives.length, 2);
    assert.ok(out.endsWith('\n'));
  });
});

describe('formatFidelityMarkdown', () => {
  it('states the headline score, grade and breakdown', () => {
    const md = formatFidelityMarkdown(report);
    assert.match(md, /# Clone fidelity — stripe\.com/);
    assert.match(md, /\*\*88% overall\*\* \(B\)/);
    assert.match(md, /visual 92%/);
    assert.match(md, /motion 82%/);
  });

  it('renders the motion table and ranked correction plan', () => {
    const md = formatFidelityMarkdown(report);
    assert.match(md, /\| aspect \| score \| original → clone \|/);
    assert.match(md, /springy → smooth/);
    assert.match(md, /\*\*\[high\/motion\]\*\*/);
    assert.match(md, /_fix:_ Use a spring/);
  });

  it('says so when there are no corrections', () => {
    const md = formatFidelityMarkdown({ ...report, directives: [] });
    assert.match(md, /No corrections outstanding/);
  });
});

describe('formatFidelityCard', () => {
  it('produces a self-contained SVG with the score, grade and host', () => {
    const svg = formatFidelityCard(report);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /stripe\.com/);
    assert.ok(svg.includes('>88<'), 'score is drawn');
    assert.ok(svg.includes('>B<'), 'grade is drawn');
    assert.ok(svg.trim().endsWith('</svg>'));
  });

  it('degrades gracefully when fidelity is unknown', () => {
    const svg = formatFidelityCard({ host: 'x.com', overall: null, grade: 'unknown', visual: null, motion: null });
    assert.ok(svg.includes('>—<'), 'shows a dash for missing score');
    assert.ok(svg.includes('>?<'), 'shows ? for unknown grade');
  });
});

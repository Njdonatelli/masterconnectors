import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractModernCss } from '../src/extractors/modern-css.js';

function mkStyle(overrides = {}) {
  return {
    tag: 'div',
    classList: '',
    fontVariationSettings: 'normal',
    fontFeatureSettings: 'normal',
    textWrap: '',
    textDecorationStyle: '',
    textDecorationThickness: '',
    textUnderlineOffset: '',
    pseudo: null,
    ...overrides,
  };
}

describe('extractModernCss', () => {
  it('returns zeroed structure for empty payload', () => {
    const r = extractModernCss({});
    assert.equal(r.pseudoElements.count, 0);
    assert.equal(r.variableFonts.count, 0);
    assert.equal(r.containerQueries.count, 0);
    assert.deepEqual(r.envUsage, []);
  });

  it('counts pseudo-elements and captures samples', () => {
    const light = {
      computedStyles: [
        mkStyle({ tag: 'a', pseudo: { before: { content: '"→"', color: 'red' }, after: null } }),
        mkStyle({ tag: 'li', pseudo: { before: { content: '"•"' }, after: { content: '"x"' } } }),
      ],
    };
    const r = extractModernCss({ light });
    assert.equal(r.pseudoElements.count, 3);
    assert.ok(r.pseudoElements.samples.length >= 2);
    assert.equal(r.pseudoElements.samples[0].which, '::before');
  });

  it('aggregates variable-font axes with min/max', () => {
    const light = {
      computedStyles: [
        mkStyle({ fontVariationSettings: '"wght" 400, "slnt" 0' }),
        mkStyle({ fontVariationSettings: '"wght" 700, "slnt" -8' }),
      ],
    };
    const r = extractModernCss({ light });
    assert.equal(r.variableFonts.count, 2);
    const wght = r.variableFonts.axes.find(a => a.axis === 'wght');
    assert.ok(wght);
    assert.equal(wght.min, 400);
    assert.equal(wght.max, 700);
    const slnt = r.variableFonts.axes.find(a => a.axis === 'slnt');
    assert.equal(slnt.min, -8);
    assert.equal(slnt.max, 0);
  });

  it('collects OpenType features and counts', () => {
    const light = {
      computedStyles: [
        mkStyle({ fontFeatureSettings: '"ss01" on, "cv11"' }),
        mkStyle({ fontFeatureSettings: '"ss01"' }),
      ],
    };
    const r = extractModernCss({ light });
    const ss01 = r.openTypeFeatures.find(f => f.feature === 'ss01');
    assert.equal(ss01.count, 2);
    const cv11 = r.openTypeFeatures.find(f => f.feature === 'cv11');
    assert.equal(cv11.count, 1);
  });

  it('collects modern text-layout properties', () => {
    const light = {
      computedStyles: [
        mkStyle({ textWrap: 'balance', textDecorationStyle: 'wavy', textDecorationThickness: '2px', textUnderlineOffset: '3px' }),
        mkStyle({ textWrap: 'balance' }),
        mkStyle({ textWrap: 'pretty' }),
      ],
    };
    const r = extractModernCss({ light });
    const balance = r.textWrap.wrap.find(w => w.value === 'balance');
    assert.equal(balance.count, 2);
    assert.equal(r.textWrap.decorationStyle[0].value, 'wavy');
    assert.equal(r.textWrap.decorationThickness[0].value, '2px');
    assert.equal(r.textWrap.underlineOffset[0].value, '3px');
  });

  it('passes through container queries and env() usage', () => {
    const light = {
      computedStyles: [],
      containerQueries: [
        { condition: '(min-width: 480px)', selectorText: '.card', declarationCount: 3 },
      ],
      envUsage: ['safe-area-inset-top', 'safe-area-inset-top', 'viewport-segment-top'],
    };
    const r = extractModernCss({ light });
    assert.equal(r.containerQueries.count, 1);
    assert.equal(r.containerQueries.rules[0].condition, '(min-width: 480px)');
    assert.equal(r.envUsage.length, 2);
    assert.ok(r.envUsage.includes('safe-area-inset-top'));
  });
});

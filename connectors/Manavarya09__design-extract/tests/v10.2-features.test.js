import { describe, it } from 'node:test';
import assert from 'node:assert';

import { pairDarkMode } from '../src/extractors/dark-mode-pair.js';
import { captureResponsiveScreenshots } from '../src/extractors/responsive-screenshots.js';

describe('v10.2: dark-mode pairing', () => {
  it('returns unavailable when no darkMode data was captured', () => {
    const r = pairDarkMode({ colors: { primary: { hex: '#111' } }, variables: {} });
    assert.equal(r.available, false);
  });

  it('pairs role colors between light and dark', () => {
    const design = {
      colors: {
        primary: { hex: '#0A66FF' },
        backgrounds: [{ hex: '#FFFFFF' }],
        text: [{ hex: '#111111' }],
        all: [{ hex: '#0A66FF' }, { hex: '#FFFFFF' }, { hex: '#111111' }],
      },
      variables: { '--bg': '#ffffff', '--fg': '#111111' },
      darkMode: {
        colors: {
          primary: { hex: '#4D9BFF' },
          backgrounds: [{ hex: '#0A0908' }],
          text: [{ hex: '#F3F1EA' }],
          all: [{ hex: '#4D9BFF' }, { hex: '#0A0908' }, { hex: '#F3F1EA' }],
        },
        variables: { '--bg': '#0a0908', '--fg': '#f3f1ea' },
      },
    };
    const r = pairDarkMode(design);
    assert.equal(r.available, true);
    assert.equal(r.roles.primary.light, '#0a66ff');
    assert.equal(r.roles.primary.dark, '#4d9bff');
    assert.equal(r.roles.background.light, '#FFFFFF');
    assert.equal(r.roles.background.dark, '#0A0908');
    assert.ok(r.variables['--bg']);
    assert.equal(r.pairedVarCount, 2);
    assert.equal(r.tailwind.darkMode, 'class');
    assert.ok(r.tailwind.theme.extend.colors.primary);
  });

  it('flags tokens missing from the dark pass', () => {
    const design = {
      colors: { all: [{ hex: '#fff' }, { hex: '#111' }, { hex: '#ff4800' }] },
      variables: {},
      darkMode: { colors: { all: [{ hex: '#000' }, { hex: '#fff' }] }, variables: {} },
    };
    const r = pairDarkMode(design);
    assert.ok(r.audit.missingInDark.includes('#111') || r.audit.missingInDark.includes('#ff4800'));
  });
});

describe('v10.2: responsive screenshots module', () => {
  it('exports the capture function', () => {
    assert.equal(typeof captureResponsiveScreenshots, 'function');
  });
});

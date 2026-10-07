import { describe, it } from 'node:test';
import assert from 'node:assert';

import { extractSeo } from '../src/extractors/seo.js';
import { captureCoreWebVitals, extractFontLoading } from '../src/extractors/perf.js';

describe('v10.3: SEO extractor', () => {
  it('picks up OG + Twitter + description', () => {
    const rawData = {
      light: {
        stack: {
          metas: [
            { name: 'og:title', content: 'Hello' },
            { name: 'og:description', content: 'World' },
            { name: 'twitter:card', content: 'summary_large_image' },
            { name: 'description', content: 'A desc' },
            { name: 'theme-color', content: '#FF4800' },
          ],
        },
        jsonLd: ['{"@type":"Organization","name":"Acme"}'],
        favicons: [{ rel: 'icon', href: '/favicon.ico' }],
        manifest: '/manifest.webmanifest',
      },
    };
    const r = extractSeo(rawData);
    assert.equal(r.openGraph.title, 'Hello');
    assert.equal(r.twitter.card, 'summary_large_image');
    assert.equal(r.description, 'A desc');
    assert.equal(r.themeColor, '#FF4800');
    assert.equal(r.structuredData.length, 1);
    assert.equal(r.structuredData[0].type, 'Organization');
    assert.equal(r.score.hasOg, true);
    assert.equal(r.score.hasStructuredData, true);
    assert.equal(r.score.hasFavicon, true);
  });

  it('tolerates missing metas / scripts', () => {
    const r = extractSeo({ light: { stack: { metas: [] } } });
    assert.equal(r.score.hasOg, false);
    assert.equal(r.structuredData.length, 0);
  });
});

describe('v10.3: perf module', () => {
  it('exports the capture function', () => {
    assert.equal(typeof captureCoreWebVitals, 'function');
    assert.equal(typeof extractFontLoading, 'function');
  });

  it('returns a preloadCount from stack', () => {
    const r = extractFontLoading({ classNameSample: [], metas: [{ name: 'custom', content: 'rel="preload"' }] });
    assert.ok(r.preloadCount >= 0);
  });
});

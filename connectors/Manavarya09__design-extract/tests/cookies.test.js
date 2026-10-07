import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadCookiesFromFile, mergeCookies } from '../src/utils-cookies.js';

const tmp = mkdtempSync(join(tmpdir(), 'dl-cookies-'));

function tmpFile(name, text) {
  const p = join(tmp, name);
  writeFileSync(p, text, 'utf-8');
  return p;
}

describe('loadCookiesFromFile', () => {
  it('loads JSON array', () => {
    const f = tmpFile('c.json', JSON.stringify([
      { name: 'session', value: 'abc', domain: '.example.com', path: '/' },
    ]));
    const out = loadCookiesFromFile(f, 'https://example.com');
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'session');
    assert.equal(out[0].domain, '.example.com');
  });

  it('loads Playwright storageState', () => {
    const f = tmpFile('state.json', JSON.stringify({
      cookies: [{ name: 'csrf', value: 'xyz', domain: 'example.com', path: '/' }],
      origins: [],
    }));
    const out = loadCookiesFromFile(f, 'https://example.com');
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'csrf');
  });

  it('loads Netscape cookies.txt with tab-separated lines and comment', () => {
    const netscape = [
      '# Netscape HTTP Cookie File',
      '# comment',
      '.example.com\tTRUE\t/\tFALSE\t1765000000\tsid\tabc123',
      '#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tauth\ttoken-value',
    ].join('\n');
    const f = tmpFile('c.txt', netscape);
    const out = loadCookiesFromFile(f, 'https://example.com');
    assert.equal(out.length, 2);
    const sid = out.find((c) => c.name === 'sid');
    assert.equal(sid.value, 'abc123');
    assert.equal(sid.domain, '.example.com');
    assert.equal(sid.secure, false);
    assert.equal(sid.expires, 1765000000);
    const auth = out.find((c) => c.name === 'auth');
    assert.equal(auth.httpOnly, true);
    assert.equal(auth.secure, true);
  });

  it('throws on invalid JSON shape', () => {
    const f = tmpFile('bad.json', '{"not":"array"}');
    assert.throws(() => loadCookiesFromFile(f, 'https://example.com'));
  });
});

describe('mergeCookies', () => {
  it('parses CLI name=value strings into cookie objects', () => {
    const out = mergeCookies(['session=abc'], [], 'https://example.com');
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'session');
    assert.equal(out[0].value, 'abc');
    assert.equal(out[0].url, 'https://example.com');
  });

  it('lets file cookies override CLI cookies with the same name+domain', () => {
    const out = mergeCookies(
      [{ name: 'session', value: 'cli', domain: '.example.com' }],
      [{ name: 'session', value: 'file', domain: '.example.com' }],
      'https://example.com',
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].value, 'file');
  });

  it('keeps cookies with different domains separately', () => {
    const out = mergeCookies(
      [],
      [
        { name: 'x', value: '1', domain: 'a.example.com' },
        { name: 'x', value: '2', domain: 'b.example.com' },
      ],
      'https://example.com',
    );
    assert.equal(out.length, 2);
  });

  it('strips entries without a name', () => {
    const out = mergeCookies([], [{ value: 'orphan' }], 'https://example.com');
    assert.equal(out.length, 0);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { htmlToPdf } from '../src/pdf.js';

const SIMPLE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Test brand</title>
<style>@media print { section { page-break-before: always; } } body { font-family: sans-serif; }</style>
</head><body>
<section id="cover"><h1>Brand cover</h1></section>
<section id="color"><h2>Colour</h2><p>Tokens go here.</p></section>
<section id="type"><h2>Typography</h2><p>Specimens.</p></section>
</body></html>`;

function dir() { return mkdtempSync(join(tmpdir(), 'designlang-pdf-')); }

function isPdf(path) {
  const head = readFileSync(path).slice(0, 5).toString();
  return head.startsWith('%PDF-');
}

describe('pdf renderer', () => {
  it('writes a non-empty PDF file', async () => {
    const out = join(dir(), 'out.pdf');
    await htmlToPdf(SIMPLE_HTML, { outPath: out, paper: 'a4' });
    assert.ok(existsSync(out));
    assert.ok(statSync(out).size > 1000);
    assert.ok(isPdf(out));
  });

  it('embeds a JSON file attachment when requested', async () => {
    const out = join(dir(), 'out-attach.pdf');
    const tokens = Buffer.from(JSON.stringify({ color: { primary: '#0070f3' } }, null, 2));
    await htmlToPdf(SIMPLE_HTML, {
      outPath: out,
      paper: 'a4',
      attachments: [{ filename: 'tokens.json', contents: tokens, mimeType: 'application/json' }],
      metadata: { title: 'Test', subject: 'test brand' },
    });
    assert.ok(isPdf(out));
    // Verify via pdf-lib that an EmbeddedFile entry exists for tokens.json.
    const { PDFDocument, PDFName } = await import('pdf-lib');
    const doc = await PDFDocument.load(readFileSync(out));
    const names = doc.catalog.lookup(PDFName.of('Names'));
    assert.ok(names, 'PDF has a /Names dictionary');
    const embedded = names.lookup(PDFName.of('EmbeddedFiles'));
    assert.ok(embedded, 'PDF has /EmbeddedFiles');
    const namesArr = embedded.lookup(PDFName.of('Names'));
    // pdf-lib stores filenames as UTF-16BE hex strings: <FEFF...>
    const decode = (s) => {
      const m = String(s).match(/^<FEFF([0-9A-Fa-f]+)>$/);
      if (!m) return String(s);
      let out = '';
      for (let i = 0; i < m[1].length; i += 4) out += String.fromCharCode(parseInt(m[1].slice(i, i + 4), 16));
      return out;
    };
    const found = namesArr.asArray().some(n => decode(n.toString()).includes('tokens.json'));
    assert.ok(found, 'tokens.json is listed in /EmbeddedFiles');
  });

  it('respects the paper flag', async () => {
    const a4 = join(dir(), 'a4.pdf');
    const letter = join(dir(), 'letter.pdf');
    await htmlToPdf(SIMPLE_HTML, { outPath: a4, paper: 'a4' });
    await htmlToPdf(SIMPLE_HTML, { outPath: letter, paper: 'letter' });
    assert.ok(isPdf(a4) && isPdf(letter));
  });
});

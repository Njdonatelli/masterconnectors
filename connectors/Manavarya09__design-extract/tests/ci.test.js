// CI failure-path tests.
//
// Covers the v12.6.x ci.js fix: when extractDesignLanguage() throws —
// Playwright crash, network timeout, DNS miss, ad-walled URL — the runner
// must NOT propagate the raw error. It must:
//   - write a partial ci-report.md (so artifact uploads aren't empty)
//   - write a ci-summary.json with extractionFailed=true and the message
//   - return { shouldFail: true, cause } so the original stack survives
//
// We exercise this by pointing runCi at an unresolvable host. DNS fails
// fast (~50–500ms) so the test stays under a few seconds.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCi } from '../src/ci.js';

// Async-aware: must `await fn(dir)` so the cleanup doesn't run before the
// inner runCi() finishes writing files. (Same helper in formatters.test.js
// is sync-only and got copy-pasted incorrectly the first time around.)
async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dl-ci-test-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const UNREACHABLE = 'https://this-host-does-not-exist-XYZ.invalid';

describe('runCi — extraction-failure path', () => {
  it('returns shouldFail=true without throwing when extraction blows up', async () => {
    await withTempDir(async (dir) => {
      const r = await runCi(UNREACHABLE, { out: dir });
      assert.equal(r.shouldFail, true);
      assert.ok(r.cause, 'must surface original error via cause');
      assert.ok(r.cause.message, 'cause must carry a message');
    });
  });

  it('writes a ci-report.md and ci-summary.json even on failure', async () => {
    await withTempDir(async (dir) => {
      await runCi(UNREACHABLE, { out: dir });
      const mdPath = join(dir, 'ci-report.md');
      const sumPath = join(dir, 'ci-summary.json');
      assert.ok(existsSync(mdPath), 'ci-report.md missing on failure');
      assert.ok(existsSync(sumPath), 'ci-summary.json missing on failure');

      const md = readFileSync(mdPath, 'utf-8');
      assert.match(md, /## designlang/);
      assert.match(md, /failed/);
      // The failure block must contain a fenced code block (the stack).
      assert.match(md, /```[\s\S]*?```/);
    });
  });

  it('summary preserves the success-path schema + adds extractionFailed flag', async () => {
    await withTempDir(async (dir) => {
      const r = await runCi(UNREACHABLE, { out: dir });
      const sum = r.summary;
      // Schema must match the success path: url, score, grade, driftVerdict, timestamp.
      for (const key of ['url', 'score', 'grade', 'driftVerdict', 'timestamp']) {
        assert.ok(key in sum, `summary missing key: ${key}`);
      }
      // Plus the failure-only flags.
      assert.equal(sum.extractionFailed, true);
      assert.equal(typeof sum.error, 'string');
      assert.equal(sum.score, null, 'score should be null on failure');
      assert.equal(sum.grade, null, 'grade should be null on failure');
      assert.equal(sum.driftVerdict, 'unknown');
      assert.equal(sum.url, UNREACHABLE);
    });
  });

  it('does not throw — failure must be a structured return value', async () => {
    await withTempDir(async (dir) => {
      // assert.doesNotThrow doesn't wait on async, so we wrap manually.
      let threw = null;
      try { await runCi(UNREACHABLE, { out: dir }); } catch (e) { threw = e; }
      assert.equal(threw, null, 'runCi must return on extraction failure, not throw');
    });
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { extractFormStates } from '../src/extractors/form-states.js';

describe('v10.5: form states', () => {
  it('detects skeleton-loading + spinner + empty-state + error-state from class samples', () => {
    const rawData = {
      light: {
        sections: [],
        stack: {
          classNameSample: [
            'card animate-pulse',
            'spinner text-blue-500',
            'empty-state container',
            'form-error text-red-500',
          ],
        },
        componentCandidates: [],
      },
    };
    const r = extractFormStates(rawData);
    assert.ok(r.flags.includes('skeleton-loading'));
    assert.ok(r.flags.includes('spinner-loading'));
    assert.ok(r.flags.includes('empty-state'));
    assert.ok(r.flags.includes('error-state'));
  });

  it('detects modal containers from section class names', () => {
    const rawData = {
      light: {
        sections: [{ tag: 'div', className: 'modal dialog-overlay', role: 'dialog' }],
        stack: { classNameSample: [] },
        componentCandidates: [],
      },
    };
    const r = extractFormStates(rawData);
    assert.equal(r.modals.length, 1);
    assert.ok(r.flags.includes('modal'));
  });

  it('detects sonner toast library', () => {
    const rawData = {
      light: {
        sections: [],
        stack: {
          classNameSample: ['sonner-toast group'],
          scripts: [],
        },
        componentCandidates: [],
      },
    };
    const r = extractFormStates(rawData);
    assert.ok(r.toastLibraries.includes('sonner'));
  });

  it('summarises form input candidates', () => {
    const rawData = {
      light: {
        sections: [],
        stack: { classNameSample: [] },
        componentCandidates: [
          { kind: 'input', css: { borderRadius: '6px', padding: '8px 12px', border: '1px solid #ddd' } },
          { kind: 'input', css: { borderRadius: '6px', padding: '8px 12px', border: '1px solid #ddd' } },
          { kind: 'input', css: { borderRadius: '0px', padding: '12px', border: '2px solid #000' } },
        ],
      },
    };
    const r = extractFormStates(rawData);
    assert.equal(r.forms.count, 3);
    assert.ok(r.flags.includes('forms'));
  });
});

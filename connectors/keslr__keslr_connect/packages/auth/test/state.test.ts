import { describe, expect, it } from 'vitest';
import {
  generateNonce,
  generateState,
  MemoryAuthorizationRequestStore,
  toPendingRequest,
  verifyState,
} from '../src/state.js';

describe('generateState / generateNonce', () => {
  it('produce URL-safe values', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produce values with at least 256 bits of entropy', () => {
    // 32 bytes base64url-encodes to 43 characters.
    expect(generateState().length).toBeGreaterThanOrEqual(43);
    expect(generateNonce().length).toBeGreaterThanOrEqual(43);
  });

  it('never collide across many generations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      seen.add(generateState());
      seen.add(generateNonce());
    }
    expect(seen.size).toBe(4000);
  });
});

describe('verifyState', () => {
  it('accepts an exact match', () => {
    const state = generateState();
    expect(verifyState(state, state)).toBe(true);
  });

  it('rejects a different value', () => {
    expect(verifyState(generateState(), generateState())).toBe(false);
  });

  it.each([[undefined], ['']])('rejects the empty value %s', (value) => {
    expect(verifyState(value as never, generateState())).toBe(false);
  });

  it('rejects a value that is merely a prefix', () => {
    const state = generateState();
    expect(verifyState(state.slice(0, -1), state)).toBe(false);
  });
});

describe('MemoryAuthorizationRequestStore', () => {
  function pending(state: string, ttlMs = 60_000) {
    return {
      state,
      nonce: 'nonce',
      codeVerifier: 'a'.repeat(43),
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  it('round-trips a request', () => {
    const store = new MemoryAuthorizationRequestStore();
    store.put(pending('state-1'));

    const taken = store.take('state-1');
    expect(taken?.nonce).toBe('nonce');
  });

  // Single use is what stops an authorization code being replayed.
  it('removes the entry on take, so a second take returns null', () => {
    const store = new MemoryAuthorizationRequestStore();
    store.put(pending('state-1'));

    expect(store.take('state-1')).not.toBeNull();
    expect(store.take('state-1')).toBeNull();
  });

  it('returns null for an unknown state', () => {
    expect(new MemoryAuthorizationRequestStore().take('never-stored')).toBeNull();
  });

  it('returns null for an expired entry, and still consumes it', () => {
    const store = new MemoryAuthorizationRequestStore();
    store.put(pending('state-1', -1000));

    expect(store.take('state-1')).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('evicts expired entries when new ones are stored', () => {
    const store = new MemoryAuthorizationRequestStore();
    store.put(pending('expired', -1000));
    store.put(pending('fresh'));

    expect(store.size()).toBe(1);
  });

  // Without a bound, hitting the login route in a loop exhausts the heap.
  it('bounds its size', () => {
    const store = new MemoryAuthorizationRequestStore(10);
    for (let i = 0; i < 100; i++) store.put(pending(`state-${i}`));

    expect(store.size()).toBeLessThanOrEqual(10);
  });

  it('clear() drops everything', () => {
    const store = new MemoryAuthorizationRequestStore();
    store.put(pending('a'));
    store.put(pending('b'));
    store.clear();

    expect(store.size()).toBe(0);
  });
});

describe('toPendingRequest', () => {
  it('keeps only the fields worth persisting', () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const request = {
      url: 'https://id.keslr.test/oidc/authorize?...',
      state: 's',
      nonce: 'n',
      codeVerifier: 'v'.repeat(43),
      expiresAt,
    };

    const result = toPendingRequest(request, '/dashboard');

    expect(result).toEqual({
      state: 's',
      nonce: 'n',
      codeVerifier: 'v'.repeat(43),
      expiresAt,
      returnTo: '/dashboard',
    });
    expect(result).not.toHaveProperty('url');
  });
});

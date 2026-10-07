import { describe, expect, it, vi } from 'vitest';
import {
  destroySession,
  regenerateSession,
  SessionAuthorizationRequestStore,
  type SessionLike,
} from '../src/session.js';
import { sanitizeReturnTo } from '../src/router.js';

function pending(state: string, ttlMs = 600_000) {
  return {
    state,
    nonce: `nonce-${state}`,
    codeVerifier: 'a'.repeat(43),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

describe('SessionAuthorizationRequestStore', () => {
  it('round-trips a request', () => {
    const session: SessionLike = {};
    const store = new SessionAuthorizationRequestStore(session);

    store.put(pending('state-1'));
    const taken = store.take('state-1');

    expect(taken?.nonce).toBe('nonce-state-1');
    expect(taken?.codeVerifier).toBe('a'.repeat(43));
  });

  it('is single use', () => {
    const store = new SessionAuthorizationRequestStore({});
    store.put(pending('state-1'));

    expect(store.take('state-1')).not.toBeNull();
    expect(store.take('state-1')).toBeNull();
  });

  it('returns null for an unknown state', () => {
    expect(new SessionAuthorizationRequestStore({}).take('nope')).toBeNull();
  });

  // Two tabs, or a stale tab plus a fresh one, must both work.
  it('supports several concurrent logins', () => {
    const store = new SessionAuthorizationRequestStore({});

    store.put(pending('tab-1'));
    store.put(pending('tab-2'));

    expect(store.take('tab-1')?.nonce).toBe('nonce-tab-1');
    expect(store.take('tab-2')?.nonce).toBe('nonce-tab-2');
  });

  it('expires stale entries', () => {
    const store = new SessionAuthorizationRequestStore({});
    store.put(pending('old', -1000));

    expect(store.take('old')).toBeNull();
  });

  it('evicts expired entries when new ones arrive', () => {
    const store = new SessionAuthorizationRequestStore({});
    store.put(pending('old', -1000));
    store.put(pending('fresh'));

    expect(store.size()).toBe(1);
  });

  it('bounds the number of pending logins', () => {
    const store = new SessionAuthorizationRequestStore({});
    for (let i = 0; i < 50; i++) store.put(pending(`state-${i}`));

    expect(store.size()).toBeLessThanOrEqual(8);
  });

  it('serialises dates as ISO strings so the session survives a JSON store', () => {
    const session: SessionLike = {};
    new SessionAuthorizationRequestStore(session).put(pending('state-1'));

    const stored = session.keslr!.pending!['state-1']!;
    expect(typeof stored.expiresAt).toBe('string');
    expect(() => JSON.stringify(session)).not.toThrow();
  });

  it('survives a serialise/deserialise round trip', () => {
    const session: SessionLike = {};
    new SessionAuthorizationRequestStore(session).put(pending('state-1'));

    const revived = JSON.parse(JSON.stringify(session)) as SessionLike;
    const taken = new SessionAuthorizationRequestStore(revived).take('state-1');

    expect(taken?.nonce).toBe('nonce-state-1');
    expect(taken?.expiresAt).toBeInstanceOf(Date);
  });
});

describe('regenerateSession', () => {
  // Session fixation: without rotation, a pre-set session ID stays valid after
  // login and the attacker is inside the authenticated session.
  it('rotates the session ID and preserves Keslr state', async () => {
    let regenerated = false;
    const session: SessionLike = {
      keslr: { authenticatedAt: '2026-08-07T00:00:00.000Z' },
      regenerate(callback) {
        regenerated = true;
        delete session.keslr; // what express-session actually does
        callback();
      },
    };

    const rotated = await regenerateSession({ session });

    expect(regenerated).toBe(true);
    expect(rotated).toBe(session);
    expect(session.keslr?.authenticatedAt).toBe('2026-08-07T00:00:00.000Z');
  });

  it('returns the session unchanged when the store cannot regenerate', async () => {
    const session: SessionLike = {};
    await expect(regenerateSession({ session })).resolves.toBe(session);
  });

  it('rejects when there is no session at all', async () => {
    await expect(regenerateSession({})).rejects.toThrow(/No session/);
  });

  it('rejects when regeneration fails', async () => {
    const session: SessionLike = {
      regenerate(callback) {
        callback(new Error('store offline'));
      },
    };

    await expect(regenerateSession({ session })).rejects.toThrow('store offline');
  });
});

describe('destroySession', () => {
  it('calls destroy when available', async () => {
    const destroy = vi.fn((callback: (err?: unknown) => void) => callback());
    await destroySession({ destroy });

    expect(destroy).toHaveBeenCalled();
  });

  it('falls back to deleting the keslr key', async () => {
    const session: SessionLike = { keslr: { authenticatedAt: 'now' } };
    await destroySession(session);

    expect(session.keslr).toBeUndefined();
  });
});

describe('sanitizeReturnTo', () => {
  it('accepts an absolute path', () => {
    expect(sanitizeReturnTo('/dashboard')).toBe('/dashboard');
  });

  it('accepts a path with a query string', () => {
    expect(sanitizeReturnTo('/search?q=keslr')).toBe('/search?q=keslr');
  });

  // Open redirect: the member logs in on a domain they trust and lands somewhere
  // they don't.
  it('rejects an absolute URL', () => {
    expect(sanitizeReturnTo('https://evil.example/phish')).toBeUndefined();
  });

  it('rejects a protocol-relative URL that looks like a path', () => {
    expect(sanitizeReturnTo('//evil.example/phish')).toBeUndefined();
  });

  it('rejects a backslash-obfuscated URL', () => {
    expect(sanitizeReturnTo('/\\evil.example')).toBeUndefined();
  });

  it.each([[''], [undefined], [null], [42], [{}]])('rejects %s', (value) => {
    expect(sanitizeReturnTo(value)).toBeUndefined();
  });
});

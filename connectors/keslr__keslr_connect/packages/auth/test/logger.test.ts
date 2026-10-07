import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleLogger, noopLogger, redact } from '../src/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('noopLogger', () => {
  it('discards everything without throwing', () => {
    expect(() => {
      noopLogger.debug({ a: 1 });
      noopLogger.info({ a: 1 }, 'msg');
      noopLogger.warn({ a: 1 });
      noopLogger.error({ a: 1 }, 'msg');
    }).not.toThrow();
  });

  it('returns undefined from every level', () => {
    expect(noopLogger.debug({})).toBeUndefined();
    expect(noopLogger.info({})).toBeUndefined();
    expect(noopLogger.warn({})).toBeUndefined();
    expect(noopLogger.error({})).toBeUndefined();
  });
});

describe('redact', () => {
  // Defence in depth. The package never passes credentials to the logger, but
  // application code wrapping it might, and future versions of this package
  // might regress.
  it.each([
    'access_token',
    'refresh_token',
    'id_token',
    'code',
    'code_verifier',
    'client_secret',
    'authorization',
    'cookie',
    'password',
  ])('redacts %s', (key) => {
    expect(redact({ [key]: 'super-secret-value' })).toEqual({ [key]: '[redacted]' });
  });

  it('matches key names case-insensitively', () => {
    expect(redact({ Access_Token: 'x', CLIENT_SECRET: 'y' })).toEqual({
      Access_Token: '[redacted]',
      CLIENT_SECRET: '[redacted]',
    });
  });

  it('redacts camelCase variants', () => {
    expect(redact({ accessToken: 'x', codeVerifier: 'y', clientSecret: 'z' })).toEqual({
      accessToken: '[redacted]',
      codeVerifier: '[redacted]',
      clientSecret: '[redacted]',
    });
  });

  it('leaves non-sensitive keys alone', () => {
    expect(redact({ sub: 'member-1', verificationStatus: 'verified', count: 3 })).toEqual({
      sub: 'member-1',
      verificationStatus: 'verified',
      count: 3,
    });
  });

  it('recurses into nested objects', () => {
    expect(redact({ outer: { inner: { access_token: 'x', safe: 'y' } } })).toEqual({
      outer: { inner: { access_token: '[redacted]', safe: 'y' } },
    });
  });

  it('recurses into arrays', () => {
    expect(redact({ items: [{ code: 'a' }, { code: 'b' }] })).toEqual({
      items: [{ code: '[redacted]' }, { code: '[redacted]' }],
    });
  });

  it('passes through primitives', () => {
    expect(redact('a string')).toBe('a string');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(true)).toBe(true);
  });

  // A cyclic or absurdly deep object must not blow the stack inside a logger.
  it('truncates beyond a depth limit', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 20; i++) deep = { nested: deep };

    expect(JSON.stringify(redact(deep))).toContain('[truncated]');
  });
});

describe('createConsoleLogger', () => {
  it('writes at or above the configured level', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    const logger = createConsoleLogger('info');
    logger.info({ a: 1 });
    logger.debug({ a: 1 });

    expect(info).toHaveBeenCalledOnce();
    expect(debug).not.toHaveBeenCalled();
  });

  it('writes everything at debug level', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logger = createConsoleLogger('debug');
    logger.debug({ a: 1 });
    logger.error({ a: 1 });

    expect(debug).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('suppresses everything below error at error level', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logger = createConsoleLogger('error');
    logger.warn({ a: 1 });
    logger.error({ a: 1 });

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it('includes the level in the payload', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    createConsoleLogger('info').info({ sub: 'member-1' });

    expect(info).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', sub: 'member-1' }));
  });

  it('passes the message first when one is supplied', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    createConsoleLogger('info').info({ sub: 'member-1' }, 'Member authenticated');

    expect(info).toHaveBeenCalledWith(
      'Member authenticated',
      expect.objectContaining({ sub: 'member-1' }),
    );
  });

  it('redacts before writing', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    createConsoleLogger('info').info({ access_token: 'super-secret-value' });

    expect(JSON.stringify(info.mock.calls)).not.toContain('super-secret-value');
    expect(JSON.stringify(info.mock.calls)).toContain('[redacted]');
  });

  it('defaults to info', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const logger = createConsoleLogger();
    logger.debug({ a: 1 });
    logger.info({ a: 1 });

    expect(debug).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
  });
});

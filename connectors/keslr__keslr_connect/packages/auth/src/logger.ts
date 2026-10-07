/**
 * Logging helpers.
 *
 * The default is silent. A library that writes to stdout without being asked is
 * a library that corrupts someone's structured log pipeline, and auth libraries
 * in particular are prone to logging things they should not.
 */

import type { Logger } from './types.js';

/** A logger that discards everything. The default. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * A logger backed by `console`, for local development.
 *
 * @param level - Minimum level to emit. Defaults to `info`.
 */
export function createConsoleLogger(level: 'debug' | 'info' | 'warn' | 'error' = 'info'): Logger {
  const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const threshold = order[level];

  const emit =
    (method: 'debug' | 'info' | 'warn' | 'error') =>
    (obj: Record<string, unknown>, msg?: string): void => {
      if (order[method] < threshold) return;
      const payload = { level: method, ...(redact(obj) as Record<string, unknown>) };
      if (msg) console[method](msg, payload);
      else console[method](payload);
    };

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
}

/**
 * Keys whose values are replaced with `[redacted]` before logging.
 *
 * This is defence in depth, not a licence to pass secrets to the logger. The
 * package itself never logs credentials; this catches mistakes in application
 * code that wraps it, and mistakes in future versions of this package.
 */
const REDACTED_KEYS = new Set([
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'code',
  'code_verifier',
  'codeverifier',
  'client_secret',
  'clientsecret',
  'authorization',
  'cookie',
  'password',
]);

/** Recursively replace sensitive values. Exported for testing. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(entry, depth + 1);
    }
    return output;
  }

  return value;
}

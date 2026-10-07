/**
 * HTTP transport: timeouts, bounded retries, and error normalisation.
 *
 * Two rules govern retry behaviour here, and both matter for correctness rather
 * than just politeness:
 *
 * 1. **Only idempotent requests are retried.** Discovery and JWKS fetches are
 *    GETs and safe to repeat. The token exchange is not: authorization codes are
 *    single-use, so a retry after a request that actually succeeded server-side
 *    will fail with `invalid_grant` and turn a transient blip into a hard login
 *    failure. `requestJson` never retries POSTs.
 *
 * 2. **Backoff is jittered.** When a provider has a bad minute, every one of your
 *    instances observes it simultaneously. Un-jittered backoff means they all
 *    retry in lockstep and arrive as a thundering herd at exactly the moment the
 *    provider is least able to serve them.
 */

import { TransportError } from './errors.js';
import type { FetchLike, Logger } from './types.js';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Form-encoded body. Only meaningful for POST. */
  form?: Record<string, string>;
  timeoutMs: number;
  /** Attempts *after* the first. Ignored for POST. */
  maxRetries: number;
  fetch: FetchLike;
  logger: Logger;
  /** Label used in logs and error messages, e.g. `discovery`. */
  operation: string;
}

export interface JsonResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

/** Base delay for exponential backoff, in milliseconds. */
const BASE_BACKOFF_MS = 200;
/** Ceiling on any single backoff interval, in milliseconds. */
const MAX_BACKOFF_MS = 2_000;

/**
 * Full jitter backoff: `random(0, min(cap, base * 2^attempt))`.
 *
 * Exported for testing. See "Exponential Backoff And Jitter", AWS Architecture
 * Blog — full jitter minimises contention at the cost of slightly higher
 * variance in individual request latency, which is the right trade for auth.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 5xx and 429 are worth retrying; 4xx means the request itself is wrong. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Perform a request and parse the response as JSON.
 *
 * Non-2xx responses are returned rather than thrown when the body parses — the
 * caller needs the body to read OAuth error responses, which arrive with 400.
 * Transport-level failures throw {@link TransportError}.
 */
export async function requestJson<T>(
  url: string,
  options: RequestOptions,
): Promise<JsonResponse<T>> {
  const method = options.method ?? 'GET';
  const attempts = method === 'GET' ? options.maxRetries + 1 : 1;

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelayMs(attempt - 1);
      options.logger.debug(
        { operation: options.operation, attempt, delayMs: delay },
        'Retrying request after backoff',
      );
      await sleep(delay);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const init: RequestInit = {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...options.headers,
        },
      };

      if (options.form) {
        init.body = new URLSearchParams(options.form).toString();
        init.headers = {
          ...init.headers,
          'Content-Type': 'application/x-www-form-urlencoded',
        };
      }

      const response = await options.fetch(url, init);
      const text = await response.text();

      if (isRetryableStatus(response.status) && attempt < attempts - 1) {
        lastError = new TransportError(
          'network_error',
          `${options.operation} failed with HTTP ${response.status}`,
          { status: response.status },
        );
        continue;
      }

      let body: T;
      try {
        body = (text ? JSON.parse(text) : {}) as T;
      } catch (cause) {
        throw new TransportError(
          'network_error',
          `${options.operation} returned a body that is not valid JSON`,
          {
            cause,
            status: response.status,
            detail: {
              operation: options.operation,
              status: response.status,
              // A short prefix only. The body may contain sensitive material and
              // is untrusted; never log it wholesale.
              bodyPreview: text.slice(0, 120),
            },
          },
        );
      }

      return { status: response.status, body, headers: response.headers };
    } catch (error) {
      if (error instanceof TransportError) {
        // Already normalised — either a JSON parse failure (fatal) or a
        // retryable status recorded above.
        if (error.code === 'network_error' && error.detail?.operation) throw error;
        lastError = error;
      } else if (isAbortError(error)) {
        lastError = new TransportError(
          'timeout',
          `${options.operation} timed out after ${options.timeoutMs}ms`,
          { cause: error, detail: { operation: options.operation, timeoutMs: options.timeoutMs } },
        );
      } else {
        lastError = new TransportError(
          'network_error',
          `${options.operation} failed: ${describeError(error)}`,
          { cause: error, detail: { operation: options.operation } },
        );
      }

      if (attempt === attempts - 1) throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }

  /* c8 ignore next -- unreachable: the loop either returns or throws */
  throw lastError ?? new TransportError('network_error', `${options.operation} failed`);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

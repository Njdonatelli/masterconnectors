/**
 * base64url encoding helpers (RFC 4648 §5).
 *
 * Node's `Buffer` has supported the `base64url` encoding name since v14.18, but
 * we implement it explicitly here so the package behaves identically under
 * runtimes with a partial Buffer shim, and so the padding rules are visible
 * rather than assumed.
 */

/** Encode bytes as base64url: no padding, `-` for `+`, `_` for `/`. */
export function encodeBase64Url(input: Uint8Array | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url to bytes.
 *
 * Padding is restored before decoding. Input whose length mod 4 is 1 cannot be
 * valid base64 and is rejected rather than silently truncated — Node's decoder
 * is lenient here, and leniency in a token parser is how malformed input becomes
 * accepted input.
 */
export function decodeBase64Url(input: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) {
    throw new TypeError('Value is not valid base64url: contains characters outside the alphabet');
  }

  const remainder = input.length % 4;
  if (remainder === 1) {
    throw new TypeError('Value is not valid base64url: impossible length');
  }

  const padded =
    input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(remainder ? 4 - remainder : 0);
  return Buffer.from(padded, 'base64');
}

/** Decode base64url and interpret the bytes as UTF-8. */
export function decodeBase64UrlToString(input: string): string {
  return decodeBase64Url(input).toString('utf8');
}

/**
 * Decode a base64url segment and parse it as JSON.
 *
 * @throws {SyntaxError} when the decoded bytes are not valid JSON.
 */
export function decodeBase64UrlToJson<T = unknown>(input: string): T {
  return JSON.parse(decodeBase64UrlToString(input)) as T;
}

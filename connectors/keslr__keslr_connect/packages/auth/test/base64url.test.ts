import { describe, expect, it } from 'vitest';
import {
  decodeBase64Url,
  decodeBase64UrlToJson,
  decodeBase64UrlToString,
  encodeBase64Url,
} from '../src/base64url.js';

describe('encodeBase64Url', () => {
  it('encodes a string', () => {
    expect(encodeBase64Url('hello')).toBe('aGVsbG8');
  });

  it('omits padding', () => {
    expect(encodeBase64Url('a')).not.toContain('=');
    expect(encodeBase64Url('ab')).not.toContain('=');
    expect(encodeBase64Url('abc')).not.toContain('=');
  });

  it('uses the URL-safe alphabet', () => {
    // 0xfb 0xff encodes to "+/8" in standard base64.
    const encoded = encodeBase64Url(Buffer.from([0xfb, 0xff, 0xfe]));
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encodes an empty input to an empty string', () => {
    expect(encodeBase64Url('')).toBe('');
  });
});

describe('decodeBase64Url', () => {
  it('round-trips arbitrary bytes', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Buffer.alloc(length, length);
      expect(decodeBase64Url(encodeBase64Url(bytes)).equals(bytes)).toBe(true);
    }
  });

  it('restores padding correctly for each remainder', () => {
    expect(decodeBase64UrlToString(encodeBase64Url('a'))).toBe('a');
    expect(decodeBase64UrlToString(encodeBase64Url('ab'))).toBe('ab');
    expect(decodeBase64UrlToString(encodeBase64Url('abc'))).toBe('abc');
    expect(decodeBase64UrlToString(encodeBase64Url('abcd'))).toBe('abcd');
  });

  // Node's decoder silently ignores invalid characters. A token parser must not.
  it('rejects characters outside the base64url alphabet', () => {
    expect(() => decodeBase64Url('abc!')).toThrow(TypeError);
    expect(() => decodeBase64Url('abc+')).toThrow(TypeError);
    expect(() => decodeBase64Url('abc/')).toThrow(TypeError);
    expect(() => decodeBase64Url('abc=')).toThrow(TypeError);
  });

  it('rejects an impossible length', () => {
    expect(() => decodeBase64Url('abcde')).toThrow(/impossible length/);
  });

  it('decodes an empty string to empty bytes', () => {
    expect(decodeBase64Url('').length).toBe(0);
  });
});

describe('decodeBase64UrlToJson', () => {
  it('parses a JSON payload', () => {
    const encoded = encodeBase64Url(JSON.stringify({ sub: 'abc', n: 1 }));
    expect(decodeBase64UrlToJson(encoded)).toEqual({ sub: 'abc', n: 1 });
  });

  it('throws SyntaxError on invalid JSON', () => {
    expect(() => decodeBase64UrlToJson(encodeBase64Url('not json'))).toThrow(SyntaxError);
  });

  it('handles multi-byte UTF-8', () => {
    const encoded = encodeBase64Url(JSON.stringify({ name: 'Zoë 🌍' }));
    expect(decodeBase64UrlToJson<{ name: string }>(encoded).name).toBe('Zoë 🌍');
  });
});

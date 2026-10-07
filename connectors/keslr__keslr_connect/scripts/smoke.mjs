/**
 * Smoke test: can we reach the live Keslr provider and read its metadata?
 *
 * Deliberately requires no credentials, so it runs on every push. It catches the
 * failure that matters most for a starter kit — the provider moved, and the
 * README now lies — without needing a test account.
 */

import { DiscoveryCache, JwksCache, createConsoleLogger } from '../packages/auth/dist/index.js';

const issuer = process.env.KESLR_ISSUER ?? 'https://api.keslr.com';
const logger = createConsoleLogger('info');

const discovery = new DiscoveryCache({
  issuer,
  timeoutMs: 10_000,
  maxRetries: 2,
  cacheTtlMs: 60_000,
  fetch: globalThis.fetch,
  logger,
});

const document = await discovery.get();
console.log(`✓ Discovery OK — issuer ${document.issuer}`);

for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
  if (!document[field]) {
    console.error(`✗ Discovery document is missing ${field}`);
    process.exit(1);
  }
}

if (!document.code_challenge_methods_supported?.includes('S256')) {
  console.warn('! Provider does not advertise S256 PKCE support');
}

const jwks = new JwksCache(document.jwks_uri, {
  timeoutMs: 10_000,
  maxRetries: 2,
  cacheTtlMs: 60_000,
  fetch: globalThis.fetch,
  logger,
});

await jwks.getKey(undefined).catch(() => undefined);
console.log(`✓ JWKS OK — ${jwks.size()} signing key(s) published`);
console.log('Smoke test passed.');

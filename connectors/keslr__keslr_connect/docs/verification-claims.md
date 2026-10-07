# Verification claims

The three claims that make Keslr different from any other identity provider.

## The claims

| Claim                 | Type               | Meaning                                             |
| --------------------- | ------------------ | --------------------------------------------------- |
| `keslr_id`            | `KID-XXXXXXXXXXXX` | Public member identifier                            |
| `verification_status` | enum               | Where the member sits in the verification lifecycle |
| `verification_method` | enum               | How they came to be verified                        |

These arrive in both the ID token and the UserInfo response. `@keslr/auth` normalises them onto `KeslrUser`.

## `verification_status`

| Value                  | Meaning                                           | `isVerified` |
| ---------------------- | ------------------------------------------------- | ------------ |
| `verified`             | A real human, vouched for through the trust graph | `true`       |
| `pending_verification` | Verification underway, not yet decided            | `false`      |
| `unverified`           | Registered but never verified                     | `false`      |
| `rejected`             | Verification attempted and refused                | `false`      |

Because Keslr is invite-only, the overwhelming majority of accounts your application sees are `verified` — members are verified at registration, by accepting an invitation. The other states exist and must be handled, but they are the exception.

### Always read `isVerified`

```ts
if (user.isVerified) {
  /* ✓ */
}

if (user.verificationStatus === 'verified') {
  /* works, but fragile */
}
if (user.raw.verification_status === 'Verified') {
  /* ✗ silently always false */
}
```

Every way of getting the string comparison wrong fails _open_. `isVerified` is computed once, in one place, and tested.

### Unknown statuses fail closed

If Keslr introduces a status this release has never heard of, `normalizeVerificationStatus` collapses it to `unverified` rather than throwing or passing it through. Denying a legitimate member is a bug you hear about within the hour; admitting an illegitimate one is a bug you may never hear about.

## `verification_method`

| Value                  | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `core_approver_invite` | Invited directly by a Keslr core approver               |
| `referral_approved`    | Referred by a verified member, verified on registration |
| `referral_accepted`    | Accepted a referral after registering                   |
| `moderator_approved`   | Reviewed and approved by a moderator                    |
| `force_approved`       | Administratively approved                               |

Most applications can ignore this. It matters when trust distance is relevant to your risk model:

```ts
const HIGH_TRUST = new Set(['core_approver_invite', 'moderator_approved']);

if (amount > 10_000 && !HIGH_TRUST.has(user.verificationMethod ?? '')) {
  await queueForManualReview(transaction);
}
```

Treat the type as open-ended. Keslr may add methods, and an unrecognised value must never crash your integration — which is why `VerificationMethod` is a union with `(string & {})`.

## Patterns

### Gate a route

```ts
import { requireVerified } from '@keslr/express';
app.post('/posts', requireVerified(), handler);
```

The 403 body includes the member's actual status and a plain-language explanation. A bare "forbidden" gives someone who thought they had an account no way to understand or fix the problem.

### Gate in business logic

```ts
import { assertVerified, NotVerifiedError } from '@keslr/auth';

try {
  assertVerified(user);
  await publishPost(user.id, body);
} catch (error) {
  if (error instanceof NotVerifiedError) {
    return render('verification-needed', { status: error.verificationStatus });
  }
  throw error;
}
```

### Degrade rather than block

Often better than a hard gate: let unverified members read, and require verification to write.

```ts
app.get('/posts', requireAuth(), listPosts);
app.post('/posts', requireVerified(), createPost);
```

### Explain the state

```ts
import { describeVerificationStatus } from '@keslr/auth';

res.render('gate', { message: describeVerificationStatus(user.verificationStatus) });
// unverified → "This member has not been verified. Keslr membership is granted by
//               invitation from an existing verified member."
```

## Persisting

Key your rows on `user.id` — the OIDC `sub`, a UUID that never changes. It is the same value as `req.keslrNetwork.userId` from `@keslr/network`, so an app that identifies some callers by address and others by login can join them on one column.

Not on `keslrId` (public and cross-referenced, but display-oriented), not on `username` or `email` (both mutable, both a migration waiting to happen).

```ts
await db.users.upsert({
  where: { keslrSub: user.id },
  update: { username: user.username, verificationStatus: user.verificationStatus },
  create: { keslrSub: user.id, keslrId: user.keslrId, username: user.username },
});
```

**Re-read the status on each login rather than trusting a cached copy.** Verification is not monotonic: an account can be revoked. A row that says `verified` from six months ago is a claim about six months ago.

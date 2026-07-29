# `auth set-token` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `mydevices auth set-token <token>` command that stores a user-supplied access token (e.g., a JWT pasted from another tool) in the CLI's config.

**Architecture:** A pure helper `decodeJwtExpiry()` in `src/lib/auth.ts` extracts the `exp` claim from a JWT without signature verification. A new `set-token` subcommand in `src/commands/auth.ts` uses it to derive `expiresAt`, rejects already-expired tokens, and stores the token via the existing `setAuthConfig()`.

**Tech Stack:** TypeScript (ESM), Bun runtime, commander, `conf` for config storage, `bun test` for the helper's unit tests.

**Spec:** `docs/superpowers/specs/2026-07-29-set-access-token-design.md`

## Global Constraints

- ESM project (`"type": "module"`): intra-project imports use `.js` extensions even for `.ts` files (e.g., `from '../lib/auth.js'`).
- Run the CLI with `bun run src/index.ts <args>`; typecheck with `bun run typecheck` (`tsc --noEmit`).
- User-facing output must use the helpers in `src/lib/output.ts`: `success(message)`, `error(message)`, `detail(label, value)`.
- Stored client credentials (`realm`, `clientId`, `clientSecret`) must NOT be modified by this feature.

---

### Task 1: JWT expiry decoding helper

**Files:**
- Modify: `src/lib/auth.ts` (append new function at end of file)
- Test: `src/lib/auth.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export function decodeJwtExpiry(token: string): number | null` in `src/lib/auth.ts` — returns the token's `exp` claim converted to **milliseconds** since epoch, or `null` if the token is not a decodable JWT or has no numeric `exp` claim. Task 2 imports this.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auth.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { decodeJwtExpiry } from './auth.js';

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.fakesignature`;
}

describe('decodeJwtExpiry', () => {
  test('returns exp claim in milliseconds', () => {
    const exp = 1790000000; // seconds since epoch
    expect(decodeJwtExpiry(makeJwt({ exp, sub: 'user' }))).toBe(exp * 1000);
  });

  test('returns null when exp claim is missing', () => {
    expect(decodeJwtExpiry(makeJwt({ sub: 'user' }))).toBeNull();
  });

  test('returns null when exp is not a number', () => {
    expect(decodeJwtExpiry(makeJwt({ exp: 'tomorrow' }))).toBeNull();
  });

  test('returns null for a non-JWT string', () => {
    expect(decodeJwtExpiry('not-a-jwt')).toBeNull();
  });

  test('returns null for a JWT with an invalid payload segment', () => {
    expect(decodeJwtExpiry('aGVhZGVy.!!!notbase64!!!.sig')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(decodeJwtExpiry('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/auth.test.ts`
Expected: FAIL — `decodeJwtExpiry` is not exported from `./auth.js` (SyntaxError/undefined import).

- [ ] **Step 3: Implement `decodeJwtExpiry`**

Append to `src/lib/auth.ts`:

```typescript
export function decodeJwtExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}
```

Note: `Buffer.from(..., 'base64url')` is lenient about garbage input — it may decode `!!!notbase64!!!` to bytes that fail `JSON.parse`, which the `catch` handles. Either failure path returns `null`, which is the contract.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/auth.test.ts`
Expected: 6 pass, 0 fail.

Also run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: add decodeJwtExpiry helper for reading JWT exp claim"
```

---

### Task 2: `auth set-token` subcommand

**Files:**
- Modify: `src/commands/auth.ts` (add subcommand before the final `return auth;`)

**Interfaces:**
- Consumes: `decodeJwtExpiry(token: string): number | null` from `../lib/auth.js` (Task 1); existing `setAuthConfig(auth: Partial<AuthConfig>): void` from `../lib/config.js`; `success`, `error`, `detail` from `../lib/output.js` (already imported in this file — `success`, `error`, `detail` are present; only `decodeJwtExpiry` needs adding to the existing `../lib/auth.js` import).
- Produces: CLI command `mydevices auth set-token <token>`.

- [ ] **Step 1: Add the subcommand**

In `src/commands/auth.ts`:

1. Extend the existing import from `../lib/auth.js`:

```typescript
import { authenticate, getTokenExpiry, decodeJwtExpiry } from '../lib/auth.js';
```

2. Extend the existing import from `../lib/config.js` to include `setAuthConfig`:

```typescript
import { getAuthConfig, clearAuthConfig, isAuthenticated, setConfig, setAuthConfig } from '../lib/config.js';
```

3. Add this block after the `auth.command('token')` block and before `return auth;`:

```typescript
auth
  .command('set-token')
  .description('Set an access token directly (e.g., a JWT obtained elsewhere)')
  .argument('<token>', 'Access token to store')
  .action((token: string) => {
    const expiresAt = decodeJwtExpiry(token);

    if (expiresAt !== null && expiresAt <= Date.now()) {
      error('Token is already expired');
      process.exit(1);
    }

    // Non-JWT or no exp claim: store with a far-future expiry so
    // isAuthenticated() passes; the API will reject it if invalid.
    const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;

    setAuthConfig({
      accessToken: token,
      refreshToken: '',
      expiresAt: expiresAt ?? Date.now() + tenYearsMs,
    });

    success('Access token saved!');
    if (expiresAt !== null) {
      detail('Expires', new Date(expiresAt).toLocaleString());
    } else {
      detail('Expires', 'unknown (could not read exp claim from token)');
    }
  });
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Generate a valid future-dated fake JWT and exercise the command (this overwrites any real stored token — check `mydevices auth whoami` first if you care, and re-run `auth login` afterwards to restore):

```bash
# 1. Fake JWT expiring in 1 hour
TOKEN=$(bun -e 'const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");console.log(`${b64({alg:"RS256"})}.${b64({exp:Math.floor(Date.now()/1000)+3600,sub:"manual-test"})}.sig`)')

bun run src/index.ts auth set-token "$TOKEN"
# Expected: "Access token saved!" + Expires with a date ~1 hour from now

bun run src/index.ts auth token
# Expected: prints $TOKEN

bun run src/index.ts auth whoami
# Expected: Token shows Valid (expires in 0h 59m or similar)

# 2. Expired JWT is rejected
EXPIRED=$(bun -e 'const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");console.log(`${b64({alg:"RS256"})}.${b64({exp:1000000000})}.sig`)')
bun run src/index.ts auth set-token "$EXPIRED"; echo "exit=$?"
# Expected: "Token is already expired", exit=1

# 3. Non-JWT stored with unknown expiry
bun run src/index.ts auth set-token "opaque-token-abc123"
# Expected: saved, Expires: unknown (could not read exp claim from token)

# 4. Missing argument
bun run src/index.ts auth set-token; echo "exit=$?"
# Expected: commander error "missing required argument 'token'", non-zero exit
```

Confirm stored client credentials were untouched: `bun run src/index.ts config list` (or inspect the config file at the path from `getConfigPath()`) — `clientId`/`clientSecret`/`realm` unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/commands/auth.ts
git commit -m "feat: add auth set-token command to store an access token directly"
```

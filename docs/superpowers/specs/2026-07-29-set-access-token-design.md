# Design: `auth set-token` command

**Date:** 2026-07-29
**Status:** Approved

## Purpose

Allow a user to set an access token directly (e.g., a JWT obtained from another tool, a browser session, or a teammate) instead of authenticating with client credentials via `auth login`.

## Command

```
mydevices auth set-token <token>
```

New subcommand added to `createAuthCommands()` in `src/commands/auth.ts`.

## Behavior

1. The token is a required positional argument.
2. Decode the JWT payload (base64url decode of the middle segment, no signature verification) to read the `exp` claim and derive `expiresAt` (milliseconds).
3. If the token is not a decodable JWT or lacks an `exp` claim, store it anyway with a far-future `expiresAt` and print a note that expiry is unknown — the API will reject the token if it is invalid.
4. If `exp` is in the past, refuse to store it: print an error ("token is already expired") and exit 1.
5. Store via the existing `setAuthConfig()` in `src/lib/config.ts`:
   - `accessToken` = the provided token
   - `expiresAt` = derived expiry (or far-future sentinel)
   - `refreshToken` = `''` (a pasted token has no matching refresh token)
6. On success, print confirmation with the expiry time using `success()` / `detail()` from `src/lib/output.ts`, mirroring `auth login` output style.

## Interaction with existing auth

- Stored client credentials (`realm`, `clientId`, `clientSecret`) are left untouched.
- When the pasted token expires, existing `getValidToken()` logic applies unchanged: it falls back to re-authenticating with stored credentials if present, otherwise instructs the user to log in or set a new token.
- `auth whoami` and `auth token` work as-is since they read the same config keys.

## Error handling

- Missing argument → commander's built-in required-argument error.
- Already-expired token → error message + exit 1.
- No other failure modes; the operation is a local config write.

## Testing

No automated test setup exists in the repo. Verification is manual:

1. Build the CLI.
2. `mydevices auth set-token <jwt>` → success output with expiry.
3. `mydevices auth whoami` shows the token as valid with correct expiry.
4. `mydevices auth token` prints the token.
5. Setting an expired JWT fails with exit 1.
6. Setting a non-JWT string stores it with an "expiry unknown" note.

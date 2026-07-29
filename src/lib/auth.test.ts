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

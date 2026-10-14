import assert from 'node:assert/strict';
import test from 'node:test';
import {
  afterLoginPath, decodeGoogleOAuthFlow, decodePendingAuth, encodeGoogleOAuthFlow, encodePendingAuth,
  parseWorkosAuthError, spanishAuthError, type GoogleOAuthFlow, type PendingAuth,
} from '../src/lib/auth-flow.ts';

const pending: PendingAuth = {
  kind: 'email_verification',
  token: 'pending-token-fixture-123',
  email: 'familia@ejemplo.cr',
  destino: 'familia',
  next: '/portal/pagos/nuevo',
  userId: 'user_fixture123',
};

const SECRET = 'synthetic-cookie-password-of-sufficient-length';

test('pending auth survives an encode/decode round trip, unicode included', async () => {
  const withUnicode = { ...pending, email: 'maría.josé@ejemplo.cr' };
  assert.deepEqual(await decodePendingAuth(await encodePendingAuth(withUnicode, SECRET), SECRET), withUnicode);
});

test('tampered or malformed pending cookies decode to no step', async () => {
  assert.equal(await decodePendingAuth(null, SECRET), null);
  assert.equal(await decodePendingAuth('', SECRET), null);
  assert.equal(await decodePendingAuth('not base64!!!', SECRET), null);
  const signed = await encodePendingAuth(pending, SECRET);
  // A swapped destination or token breaks the signature.
  const [payload, signature] = signed.split('.');
  const object = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PendingAuth;
  object.destino = 'admin';
  const forged = `${Buffer.from(JSON.stringify(object)).toString('base64url')}.${signature}`;
  assert.equal(await decodePendingAuth(forged, SECRET), null);
  assert.equal(await decodePendingAuth(signed, 'another-cookie-password-that-is-also-long'), null);
  assert.equal(await decodePendingAuth(await encodePendingAuth({ ...pending, kind: 'inventado' } as unknown as PendingAuth, SECRET), SECRET), null);
  assert.equal(await decodePendingAuth(await encodePendingAuth({ ...pending, token: 'short' }, SECRET), SECRET), null);
  assert.equal(await decodePendingAuth(await encodePendingAuth({ ...pending, kind: 'mfa_totp' }, SECRET), SECRET), null);
  assert.equal(await decodePendingAuth(await encodePendingAuth({ ...pending, kind: 'organization' }, SECRET), SECRET), null);
  assert.equal(await decodePendingAuth(await encodePendingAuth({ ...pending, userId: 'not-a-user' }, SECRET), SECRET), null);
});

test('an administrator pending step never carries a family return path', async () => {
  const decoded = await decodePendingAuth(await encodePendingAuth({ ...pending, destino: 'admin', next: '/portal/pagos/nuevo' }, SECRET), SECRET);
  assert.equal(decoded?.next, null);
});

test('google oauth flow survives its signed round trip and rejects tampering', async () => {
  const flow: GoogleOAuthFlow = {
    state: 'state-fixture-123456', codeVerifier: 'verifier-fixture-123456',
    destino: 'familia', next: '/portal/pagos/nuevo',
  };
  assert.deepEqual(await decodeGoogleOAuthFlow(await encodeGoogleOAuthFlow(flow, SECRET), SECRET), flow);
  const signed = await encodeGoogleOAuthFlow(flow, SECRET);
  const [payload, signature] = signed.split('.');
  const object = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GoogleOAuthFlow;
  object.codeVerifier = 'swapped-verifier-value';
  const forged = `${Buffer.from(JSON.stringify(object)).toString('base64url')}.${signature}`;
  assert.equal(await decodeGoogleOAuthFlow(forged, SECRET), null);
  assert.equal(await decodeGoogleOAuthFlow(signed, 'another-cookie-password-that-is-also-long'), null);
  assert.equal(await decodeGoogleOAuthFlow(null, SECRET), null);
  // An admin flow never carries a family return path, and unsafe paths fall back.
  const admin = await decodeGoogleOAuthFlow(await encodeGoogleOAuthFlow({ ...flow, destino: 'admin' }, SECRET), SECRET);
  assert.equal(admin?.next, null);
  const unsafe = await decodeGoogleOAuthFlow(await encodeGoogleOAuthFlow({ ...flow, next: 'https://evil.example/portal' }, SECRET), SECRET);
  assert.equal(unsafe?.next, null);
});

test('after login: invitation wins, admin is fixed, external paths fall back', () => {
  assert.equal(afterLoginPath('familia', '/portal/pagos/nuevo', true), '/portal/invitacion');
  assert.equal(afterLoginPath('familia', '/portal/pagos/nuevo', false), '/portal/pagos/nuevo');
  assert.equal(afterLoginPath('familia', 'https://evil.example/portal', false), '/portal');
  assert.equal(afterLoginPath('familia', '/portal/acceso', false), '/portal');
  assert.equal(afterLoginPath('familia', null, false), '/portal');
  assert.equal(afterLoginPath('admin', '/portal/pagos/nuevo', true), '/admin');
  assert.equal(afterLoginPath('admin', null, false), '/admin');
  assert.equal(afterLoginPath('admin', null, false, true), '/portal/admin-invitacion');
  assert.equal(afterLoginPath('familia', '/portal/pagos/nuevo', true, true), '/portal/admin-invitacion');
});

test('provider authentication errors expose only the documented step fields', () => {
  const parsed = parseWorkosAuthError({
    code: 'mfa_challenge',
    status: 409,
    pendingAuthenticationToken: 'pending-token-fixture',
    rawData: {
      authentication_factors: [{ id: 'auth_factor_fixture', type: 'totp' }],
      user: { id: 'user_fixture', email: 'familia@ejemplo.cr' },
      organizations: [{ id: 'org_fixture', name: 'Ajedrez Belén' }],
    },
  });
  assert.equal(parsed.code, 'mfa_challenge');
  assert.equal(parsed.pendingToken, 'pending-token-fixture');
  assert.equal(parsed.totpFactorId, 'auth_factor_fixture');
  assert.equal(parsed.userId, 'user_fixture');
  assert.deepEqual(parsed.organizations, [{ id: 'org_fixture', name: 'Ajedrez Belén' }]);
  assert.equal(parseWorkosAuthError(new Error('boom')).code, null);
  assert.equal(parseWorkosAuthError(null).pendingToken, null);
});

test('every person-facing auth message is Spanish and never leaks provider text', () => {
  const providerError = { status: 400, message: 'Invalid credentials provided by user' };
  for (const context of ['password', 'code', 'signup', 'reset', 'generic'] as const) {
    const message = spanishAuthError(providerError, context);
    assert.ok(!message.includes('Invalid'), context);
    assert.ok(!/\b(the|your|please|password is)\b/i.test(message), `${context}: ${message}`);
  }
  assert.match(spanishAuthError({ status: 429 }, 'password'), /demasiados intentos/i);
  assert.match(spanishAuthError({ status: 409 }, 'signup'), /Ya existe una cuenta/);
  assert.match(spanishAuthError(providerError, 'password'), /correo o la contraseña no son correctos/);
  assert.match(spanishAuthError(providerError, 'code'), /código no es correcto/);
});

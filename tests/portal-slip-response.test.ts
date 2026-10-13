import assert from 'node:assert/strict';
import test from 'node:test';
import { readSlipResponse, slipAuthRecovery } from '../src/lib/portal/slip-response';

test('plain-text and JSON authentication failures are classified before any body parsing', async () => {
  for (const [status, expected] of [[401, 'session_expired'], [403, 'access_denied']] as const) {
    for (const body of ['Authentication required', '', '<html>Forbidden</html>', '{"error":"different_code"}']) {
      const response = new Response(body, { status });
      await assert.rejects(readSlipResponse(response), { message: expected });
      assert.equal(response.bodyUsed, false, 'The response format must not obscure authentication status');
    }
  }
});

test('upload and OCR successes retain their JSON data while non-authentication failures preserve useful error codes', async () => {
  const draft = { draft: { id: 'fictional-draft', expiresAt: '2026-10-12T00:00:00.000Z' }, ocr: { mode: 'off', available: false } };
  assert.deepEqual(await readSlipResponse(Response.json(draft)), draft);
  const extraction = { extraction: { status: 'ready', suggestions: { amount: '12000' } } };
  assert.deepEqual(await readSlipResponse(Response.json(extraction)), extraction);
  await assert.rejects(readSlipResponse(Response.json({ error: 'draft_expired' }, { status: 410 })), { message: 'draft_expired' });
  await assert.rejects(readSlipResponse(new Response('Unavailable', { status: 503 })), { message: 'operation_failed' });
  await assert.rejects(readSlipResponse(new Response('<html>Unexpected response</html>', { status: 200 })), { message: 'operation_failed' });
});

test('manual authentication recovery uses a supported local path and does not promise restored permission', () => {
  for (const restricted of [false, true]) {
    const expired = slipAuthRecovery('session_expired', restricted)!;
    const denied = slipAuthRecovery('access_denied', restricted)!;
    assert.equal(expired.href, restricted ? '/auth/admin' : '/portal/acceso');
    assert.equal(denied.href, expired.href);
    assert.match(expired.message, /sesión venció/);
    assert.match(expired.label, /otra pestaña/);
    assert.match(denied.message, /no tiene permiso/);
    assert.match(denied.message, /consulta a la Asociación/);
    assert.match(denied.label, /otra pestaña/);
    assert.match(expired.message, /Conservamos el archivo y los datos/);
    assert.match(denied.message, /Conservamos el archivo y los datos/);
  }
  assert.equal(slipAuthRecovery('draft_expired', false), null);
  assert.equal(slipAuthRecovery('operation_failed', true), null);
});

test('controlled parent recovery returns to orgless parent login without changing owner or production recovery', () => {
  for (const code of ['session_expired', 'access_denied']) {
    assert.equal(slipAuthRecovery(code, true, true)?.href, '/auth/parent');
    assert.equal(slipAuthRecovery(code, true, false)?.href, '/auth/admin');
    assert.equal(slipAuthRecovery(code, false, true)?.href, '/portal/acceso');
  }
});

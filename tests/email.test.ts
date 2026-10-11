import assert from 'node:assert/strict';
import test from 'node:test';
import { sendReceiptEmail, type ReceiptEmailConfig, type ReceiptEmailMessage } from '../src/lib/email.ts';

const config: ReceiptEmailConfig = {
  EMAIL_MODE: 'live',
  BREVO_API_KEY: 'secret-test-key-never-print',
  EMAIL_FROM: 'receipts@example.com',
  EMAIL_FROM_NAME: 'Asociación (prueba)',
  EMAIL_TEST_RECIPIENT: 'tester@example.com',
};
const message: ReceiptEmailMessage = {
  to: 'tester@example.com',
  idempotencyKey: 'da639ed6-0ff3-4dd1-b32b-e4a27c253334',
  receipt: {
    receiptNumber: 'TEST-2026-000001', payerName: 'Persona de prueba', athleteName: 'Atleta de prueba',
    period: '2026-10', amountMinor: 1_200_000, discountMinor: 0,
    bankReference: '0000000012345678901234567890', transferDate: '2026-10-10', issuedAt: '2026-10-10T18:00:00.000Z',
  },
};

test('missing or non-live mode is a zero-network dry run even when credentials exist', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('Must not send'); };
  for (const EMAIL_MODE of [undefined, 'dry-run', 'preview', 'LIVE']) {
    assert.deepEqual(await sendReceiptEmail({ ...config, EMAIL_MODE }, message, fetcher), { status: 'dry_run' });
  }
  assert.equal(calls, 0);
});

test('live mode fails closed for missing credentials and other recipients', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('Must not send'); };
  assert.equal((await sendReceiptEmail({ EMAIL_MODE: 'live' }, message, fetcher)).status, 'blocked');
  const result = await sendReceiptEmail(config, { ...message, to: 'another-parent@example.com' }, fetcher);
  assert.deepEqual(result, { status: 'blocked', code: 'recipient_not_allowed', retryable: false });
  assert.equal((await sendReceiptEmail(config, { ...message, to: 'tester@example.com\r\nBcc:other@example.com' }, fetcher)).status, 'blocked');
  assert.equal((await sendReceiptEmail(config, { ...message, idempotencyKey: 'new-key' }, fetcher)).status, 'blocked');
  assert.equal(calls, 0);
});

test('HTTPS request includes escaped receipt, one exact recipient and persisted provider idempotency key', async () => {
  let calls = 0;
  const result = await sendReceiptEmail(config, message, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get('api-key'), config.BREVO_API_KEY);
    const body = JSON.parse(init!.body as string);
    assert.deepEqual(body.to, [{ email: config.EMAIL_TEST_RECIPIENT }]);
    assert.deepEqual(body.headers, { idempotencyKey: message.idempotencyKey });
    assert.match(body.subject, /^\[PRUEBA\]/);
    assert.match(body.htmlContent, /Datos ficticios/);
    assert.match(body.textContent, /Datos ficticios/);
    assert.equal(body.attachment, undefined);
    assert.equal(body.cc, undefined);
    assert.equal(body.bcc, undefined);
    return Response.json({ messageId: '<test-message@example.com>' }, { status: 201 });
  });
  assert.deepEqual(result, { status: 'accepted', providerMessageId: '<test-message@example.com>' });
  assert.equal(calls, 1);
  assert.ok(!('delivered' in result));
});

test('provider auth failures are redacted and rate limits are deferred without an automatic second request', async () => {
  for (const [status, code, retryable] of [[401, 'provider_auth', false], [403, 'provider_auth', false], [400, 'provider_rejected', false], [429, 'provider_limit', true]] as const) {
    let calls = 0;
    const result = await sendReceiptEmail(config, message, async () => {
      calls++;
      return Response.json({ message: `${config.BREVO_API_KEY} ${message.to}` }, { status });
    });
    assert.deepEqual(result, { status: 'rejected', code, retryable, httpStatus: status });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(config.BREVO_API_KEY!));
    assert.ok(!JSON.stringify(result).includes(message.to));
  }
});

test('ambiguous responses and duplicate requests require investigation instead of retrying', async () => {
  for (const [status, body, code] of [
    [500, { message: 'secret provider error' }, 'provider_error'],
    [408, {}, 'provider_error'],
    [200, { messageId: 'unexpected-success' }, 'provider_error'],
    [201, {}, 'invalid_provider_response'],
    [400, { code: 'duplicate_parameter', message: message.to }, 'duplicate_request'],
  ] as const) {
    let calls = 0;
    const result = await sendReceiptEmail(config, message, async () => {
      calls++;
      return Response.json(body, { status });
    });
    assert.deepEqual(result, { status: 'unknown', code, retryable: false, httpStatus: status });
    assert.equal(calls, 1);
  }
});

test('network failure and timeout remain ambiguous, abort once, and never leak exception text', async () => {
  let calls = 0;
  const failed = await sendReceiptEmail(config, message, async () => {
    calls++;
    throw new Error(`${config.BREVO_API_KEY} ${message.to}`);
  });
  assert.deepEqual(failed, { status: 'unknown', code: 'network_or_timeout', retryable: false });
  assert.equal(calls, 1);

  const timedOut = await sendReceiptEmail({ ...config, EMAIL_TIMEOUT_MS: 10 }, message, async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  assert.deepEqual(timedOut, { status: 'unknown', code: 'network_or_timeout', retryable: false });
  assert.equal(calls, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { allowLocalPrototype, parseDiscount, detectSlipType, hasSameOrigin, readBoundedBody } from '../src/lib/prototype-policy.ts';

test('synthetic access requires dev build, loopback URL and two explicit flags', () => {
  const flags = { PROTOTYPE_ENABLED: 'true', PROTOTYPE_LOCAL: 'true' };
  assert.equal(allowLocalPrototype(new URL('http://127.0.0.1:4322'), true, flags), true);
  assert.equal(allowLocalPrototype(new URL('http://127.0.0.1:4322'), false, flags), false);
  assert.equal(allowLocalPrototype(new URL('https://app.example.com'), true, flags), false);
  assert.equal(allowLocalPrototype(new URL('http://127.0.0.1:4322'), true, {}), false);
});
test('manual discount uses exact integer minor units without inferring sibling rules', () => {
  assert.equal(parseDiscount('3000'), 300000);
  assert.equal(parseDiscount('0.29'), 29);
  for (const value of ['-1', '1e3', '12000', '0.001', '1,000', 'NaN', '']) assert.throws(() => parseDiscount(value));
});
test('upload type is checked from bytes, not an attacker-provided filename', () => {
  assert.equal(detectSlipType(new TextEncoder().encode('<script>')), null);
  assert.equal(detectSlipType(new TextEncoder().encode('%PDF-1.4')), 'application/pdf');
  assert.equal(detectSlipType(new Uint8Array([255,216,255,0])), 'image/jpeg');
});
test('mutation origin guard denies missing and unrelated origins', () => {
  const url = new URL('http://127.0.0.1:4322/api/prototype/run');
  assert.equal(hasSameOrigin(new Request(url), url), false);
  assert.equal(hasSameOrigin(new Request(url, { headers: { origin: 'https://evil.example' } }), url), false);
  assert.equal(hasSameOrigin(new Request(url, { headers: { origin: url.origin } }), url), true);
});

test('request size limit applies to streamed bytes without content-length', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(600)); controller.enqueue(new Uint8Array(600)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as RequestInit);
  await assert.rejects(readBoundedBody(request, 1024), RangeError);
  assert.equal(cancelled, true);
  assert.equal(new TextDecoder().decode(await readBoundedBody(new Request('http://localhost', { method: 'POST', body: 'runId=test' }), 1024)), 'runId=test');
});

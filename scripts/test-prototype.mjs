import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const base = new URL(process.env.PROTOTYPE_TEST_URL || 'http://127.0.0.1:4322');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Tests only target a local prototype');
const request = (path, init = {}) => fetch(new URL(path, base), { ...init, redirect: 'manual' });
const origin = { origin: base.origin };
const timing = [];
async function checked(label, run) {
  const start = performance.now();
  await run();
  timing.push({ check: label, wallMs: Math.round((performance.now() - start) * 10) / 10 });
  console.log(`PASS ${label}`);
}

if (process.argv.includes('--expect-locked')) {
  await checked('compiled build never accepts the local development bypass', async () => {
    for (const path of ['/prototype', '/api/prototype/sample', '/api/prototype/receipts/unknown']) {
      const response = await request(path);
      assert.ok([401, 403, 404].includes(response.status), `${path}: ${response.status}`);
      assert.match(response.headers.get('cache-control') || '', /no-store/);
    }
  });
  process.exit(0);
}

let sample;
let runId;
await checked('public homepage and private synthetic lab render', async () => {
  const publicPage = await request('/');
  assert.equal(publicPage.status, 200);
  assert.match(await publicPage.text(), /Un tablero/);
  const lab = await request('/prototype');
  assert.equal(lab.status, 200);
  assert.match(lab.headers.get('cache-control') || '', /no-store/);
  assert.match(await lab.text(), /datos ficticios/i);
});
await checked('missing WorkOS setup fails closed', async () => {
  const response = await request('/auth/login');
  assert.equal(response.status, 503);
  assert.equal((await request('/auth/logout')).status, 405);
});
await checked('synthetic upload fixture is private', async () => {
  const response = await request('/api/prototype/sample');
  assert.equal(response.status, 200);
  sample = new Uint8Array(await response.arrayBuffer());
  assert.match(response.headers.get('cache-control') || '', /no-store/);
});
const form = (discount = '3000', bytes = sample, type = 'image/png') => {
  const data = new FormData();
  data.set('discount', discount);
  data.set('slip', new Blob([bytes], { type }), 'synthetic.png');
  return data;
};
await checked('mutations reject missing and unrelated origins', async () => {
  assert.equal((await request('/api/prototype/run', { method: 'POST', body: form() })).status, 403);
  assert.equal((await request('/api/prototype/run', { method: 'POST', headers: { origin: 'https://unrelated.example' }, body: form() })).status, 403);
});
await checked('invalid discounts and disguised active files are rejected', async () => {
  assert.equal((await request('/api/prototype/run', { method: 'POST', headers: origin, body: form('-1') })).status, 400);
  const response = await request('/api/prototype/run', { method: 'POST', headers: origin, body: form('0', new TextEncoder().encode('<script>alert(1)</script>')) });
  assert.equal(response.status, 400);
});
await checked('oversized uploads are stopped', async () => {
  const response = await request('/api/prototype/run', { method: 'POST', headers: origin, body: form('0', new Uint8Array(3 * 1024 * 1024 + 70000)) });
  assert.equal(response.status, 413);
});
await checked('email requests are bounded even without content-length', async () => {
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(1025)); controller.close();
  } });
  const response = await request('/api/prototype/email', { method: 'POST', headers: origin, body, duplex: 'half' });
  assert.equal(response.status, 413);
});
await checked('D1 write/read and R2 private upload create a synthetic receipt', async () => {
  const response = await request('/api/prototype/run', { method: 'POST', headers: origin, body: form() });
  assert.equal(response.status, 303, await response.text());
  assert.equal(response.headers.get('location'), '/prototype?notice=created');
  const html = await (await request('/prototype')).text();
  const match = html.match(/\/api\/prototype\/receipts\/([0-9a-f-]{36})/);
  assert.ok(match, 'Created receipt appears in history');
  runId = match[1];
});
await checked('private R2 download preserves the exact uploaded bytes', async () => {
  const response = await request(`/api/prototype/files/${runId}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /attachment/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), sample);
  assert.equal((await request('/api/prototype/files/00000000-0000-4000-8000-000000000000')).status, 404);
});
await checked('receipt is marked as a test with manual discount and exact reference', async () => {
  const response = await request(`/api/prototype/receipts/${runId}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /No acredita un pago real/);
  assert.match(html, /TEST-000000000000000000000001/);
  assert.match(html, /9[.,\s]?000[.,]00/);
  assert.match(html, /3[.,\s]?000[.,]00/);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'none'/);
});
await checked('email action records a dry run without contacting a provider', async () => {
  const response = await request('/api/prototype/email', { method: 'POST', headers: origin, body: new URLSearchParams({ runId }) });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/prototype?notice=dry_run');
  const receipt = await request(`/api/prototype/receipts/${runId}`);
  assert.equal(receipt.status, 200, 'Email result does not remove receipt');
});
console.log(JSON.stringify({ runtime: 'local workerd', timingKind: 'HTTP wall time, NOT CPU time or a cloud free-tier guarantee', checks: timing }, null, 2));

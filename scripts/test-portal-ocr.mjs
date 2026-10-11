import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// This exercises only synthetic DEV identities and the fixed demo reader.
// Every HTTP request is loopback-only, and every extraction is gated by the
// server's upload response announcing mode=demo before it is requested.
const base = new URL(process.env.PORTAL_TEST_URL || 'http://127.0.0.1:4322');
assert.equal(base.protocol, 'http:', 'OCR integration checks require local HTTP development');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'OCR checks are loopback-only');
assert.equal(base.username + base.password, '', 'The fixture URL must not contain credentials');
const cookies = new Map();
const timings = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGN49+6dhoYGAxADWQAtqgaFoI3S5gAAAABJRU5ErkJggg==', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/Qv4MfBj4PeMPg94F8W+LfAug63rmt6Dpl9f399plrc3d3d3NrHLNPPNLGzyyyuzO7uSzMSSSTmvSv8Ahnb9n7/omPhf/wAEtl/8ao/Z2/5N++GP/Yr6L/6RRV7HQB//2Q==', 'base64');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// A self-contained, valid two-page document; its original bytes never change.
function syntheticPdf() {
  const stream = page => `BT /F1 18 Tf 30 160 Td (Synthetic OCR fixture - page ${page}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream(1))} >>\nstream\n${stream(1)}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(stream(2))} >>\nstream\n${stream(2)}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}
const pdf = syntheticPdf();
const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const datePart = name => parts.find(item => item.type === name).value;
const transferDate = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
const future = new Date(Date.UTC(Number(datePart('year')), Number(datePart('month')), 1));
const period = `${future.getUTCFullYear()}-${String(future.getUTCMonth() + 1).padStart(2, '0')}`;
const nonce = `${Date.now()}${randomUUID().replaceAll('-', '')}`;
const reference = version => `0000OCR${nonce}${version}`;
const payerName = 'Familia sintética · campo corregido por el encargado';
const financialFields = { payerName, amount: '3000.37', transferDate };

async function request(path, role = null, init = {}) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin, 'A fixture must never request or follow an external URL');
  const headers = new Headers(init.headers);
  if (role) {
    assert.ok(cookies.has(role), `The ${role} demo identity must be initialized`);
    headers.set('cookie', cookies.get(role));
  }
  return fetch(url, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
}
function post(path, role, body, headers = {}) {
  return request(path, role, { method: 'POST', headers: { origin: base.origin, accept: 'application/json', ...headers }, body });
}
function privateHeaders(response) {
  assert.match(response.headers.get('cache-control') || '', /private/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
async function expectError(response, status, code) {
  assert.equal(response.status, status);
  // Astro may reject a forged Origin before the private route runs.
  if (status !== 403 || code) privateHeaders(response);
  if (code) assert.equal((await response.json()).error, code);
}
function fileForm(bytes, type, field = 'slip') {
  const form = new FormData();
  form.set(field, new Blob([bytes], { type }), `synthetic.${type === 'application/pdf' ? 'pdf' : type === 'image/jpeg' ? 'jpg' : 'png'}`);
  return form;
}
function paymentForm(draft, version, { bytes, type, note, expectedRevision, expectedReviewNote } = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(financialFields)) form.set(name, value);
  form.set('bankReference', reference(version));
  if (draft) form.set('draftId', draft.id);
  if (bytes) form.set('slip', new Blob([bytes], { type }), 'synthetic-original');
  if (note) form.set('note', note);
  if (expectedRevision) { form.set('expectedRevision', String(expectedRevision)); form.set('expectedStatus', 'needs_info'); form.set('expectedReviewNote', expectedReviewNote ?? ''); }
  for (const [chargeId, amount] of claims) {
    form.append('allocationChargeId[]', chargeId);
    form.append('allocationAmount[]', String(amount));
  }
  return form;
}
function redirect(response, notice) {
  assert.equal(response.status, 303);
  const location = response.headers.get('location');
  assert.ok(location);
  const url = new URL(location, base);
  assert.equal(url.origin, base.origin);
  assert.equal(url.searchParams.get('notice'), notice);
  return url;
}
async function exported(kind) {
  const response = await request(`/api/admin/export?kind=${kind}&format=json`, 'admin');
  assert.equal(response.status, 200);
  privateHeaders(response);
  return response.json();
}
async function paymentRow() {
  const row = (await exported('payments')).find(item => item.id === paymentId);
  assert.ok(row, 'The saved payment is in the authorized admin export');
  return row;
}
async function upload(bytes, type) {
  const response = await post('/api/portal/slips', 'parent-a', fileForm(bytes, type));
  assert.equal(response.status, 201);
  privateHeaders(response);
  const result = await response.json();
  assert.deepEqual(result.ocr, { mode: 'demo', available: true }, 'STOP: extraction is permitted only for the fixed synthetic demo reader');
  assert.match(result.draft.id, /^[a-f0-9-]{36}$/);
  assert.equal(result.draft.type, type);
  assert.equal(result.draft.size, bytes.length);
  assert.equal(result.draft.sha256, sha(bytes));
  assert.ok(result.draft.expiresAt > new Date().toISOString());
  assert.equal('key' in result.draft, false, 'Private storage keys are not exposed');
  return result.draft;
}
async function extract(draft, body = new FormData()) {
  const response = await post(`/api/portal/slips/${draft.id}/extract`, 'parent-a', body);
  assert.equal(response.status, 200);
  privateHeaders(response);
  const { extraction } = await response.json();
  assert.equal(extraction.mode, 'demo');
  assert.equal(extraction.model, 'fixed-demo-fixture');
  assert.equal(extraction.status, 'ready');
  assert.equal(extraction.draftId, draft.id);
  assert.equal(extraction.suggestions.amount, '12000.00');
  assert.equal(extraction.suggestions.currency, 'CRC');
  assert.equal(extraction.suggestions.transferDate, transferDate);
  assert.ok(extraction.suggestions.warnings.includes('demo_fixture'));
  return extraction;
}
function fileIds(html) {
  return [...new Set(Array.from(html.matchAll(/data-evidence-original="\/api\/portal\/files\/([a-f0-9-]{36})"/g), match => match[1]))];
}
function authorizedAthletes(html) {
  const values = Array.from(html.matchAll(/data-authorized-athletes="([^"]*)"/g), match => match[1]);
  assert.equal(values.length, 1, 'Each payment form contains one explicitly scoped athlete list');
  const decoded = values[0].replace(/&quot;/g, '"').replace(/&#(?:39|x27);/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const athletes = JSON.parse(decoded);
  assert.ok(Array.isArray(athletes));
  for (const athlete of athletes) assert.deepEqual(Object.keys(athlete).sort(), ['id', 'name'], 'Suggestions expose only authorized IDs and display names');
  return athletes.sort((left, right) => left.id.localeCompare(right.id));
}
const fixtureAthletes = {
  'demo-athlete-1': 'Timothy de prueba',
  'demo-athlete-2': 'Sofía de prueba',
  'demo-athlete-3': 'Alex independiente',
};
function expectAthletes(html, ids) {
  assert.deepEqual(authorizedAthletes(html), ids.map(id => ({ id, name: fixtureAthletes[id] })).sort((left, right) => left.id.localeCompare(right.id)));
  assert.doesNotMatch(html, /name="(?:suggestedAthleteId|ocrAthleteId|athleteSuggestion|athleteMatch)"/, 'A suggestion is not submitted as allocation authority');
}
async function exactFile(fileId, bytes, type, inline = false) {
  const response = await request(`/api/portal/files/${fileId}${inline ? '?view=inline' : ''}`, 'parent-a');
  assert.equal(response.status, 200);
  privateHeaders(response);
  assert.equal(response.headers.get('content-type'), type);
  assert.match(response.headers.get('content-security-policy') || '', /sandbox/);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(response.headers.get('content-disposition') || '', inline && type !== 'application/pdf' ? /^inline;/ : /^attachment;/);
  assert.equal(Number(response.headers.get('content-length')), bytes.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, 'The complete original evidence is unchanged');
}
async function unchangedLedger() {
  const current = (await exported('charges')).filter(charge => Object.hasOwn(beforePaid, charge.id));
  assert.deepEqual(Object.fromEntries(current.map(charge => [charge.id, charge.paid_minor])), beforePaid, 'Reading/submitting/revising a slip must not credit the ledger');
  assert.equal((await exported('receipts')).length, beforeReceiptCount, 'No numbered receipt is emitted without bank verification');
  assert.equal((await exported('email')).length, beforeEmailCount, 'OCR must not enqueue receipt email');
}
async function checked(label, run) {
  const start = performance.now();
  await run();
  timings.push({ check: label, wallMs: Math.round((performance.now() - start) * 10) / 10 });
  console.log(`PASS ${label}`);
}

let claims, beforePaid, beforeReceiptCount, beforeEmailCount;
let pngDraft, pngExtraction, jpegDraft, jpegExtraction, pdfDraft, pdfExtraction;
let paymentId;
let originalFiles = [];

await checked('local demo guard and unauthorized/cross-origin requests fail closed', async () => {
  await expectError(await post('/api/portal/slips', null, fileForm(png, 'image/png')), 401);
  await expectError(await post(`/api/portal/slips/${randomUUID()}/extract`, null, new FormData()), 401);
  for (const role of ['admin', 'parent-a', 'parent-b', 'unrelated']) {
    const response = await post('/api/portal/demo', null, new URLSearchParams({ role }));
    assert.equal(response.status, 303, 'A DEV-only synthetic identity is required');
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('portal-demo-role='));
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/i);
    cookies.set(role, cookie.split(';')[0]);
  }
  const formPage = await request('/portal/pagos/nuevo', 'parent-a');
  assert.equal(formPage.status, 200);
  const html = await formPage.text();
  assert.match(html, /data-ocr-mode="demo"/);
  assert.match(html, /data-ocr-available="true"/);
  assert.match(html, /No analiza tu archivo ni envía información a un servicio externo/);
  assert.match(await (await request('/admin/comprobantes', 'admin')).text(), /Correo en modo simulado/, 'STOP if live email is configured');
  for (const origin of [null, 'https://unrelated.example']) {
    const headers = { accept: 'application/json', ...(origin ? { origin } : {}) };
    await expectError(await request('/api/portal/slips', 'parent-a', { method: 'POST', headers, body: fileForm(png, 'image/png') }), 403);
  }
});

await checked('family-name candidate lists stay within the current parent or selected adult', async () => {
  const cases = [
    ['parent-a', '/portal/pagos/nuevo', ['demo-athlete-1', 'demo-athlete-2']],
    ['parent-b', '/portal/pagos/nuevo', ['demo-athlete-1']],
    ['unrelated', '/portal/pagos/nuevo', ['demo-athlete-3']],
    ['parent-a', '/portal/pagos/nuevo?adult=demo-unrelated', ['demo-athlete-1', 'demo-athlete-2']],
    ['admin', '/portal/pagos/nuevo', []],
    ['admin', '/portal/pagos/nuevo?adult=demo-parent-a', ['demo-athlete-1', 'demo-athlete-2']],
    ['admin', '/portal/pagos/nuevo?adult=demo-parent-b', ['demo-athlete-1']],
    ['admin', '/portal/pagos/nuevo?adult=demo-unrelated', ['demo-athlete-3']],
    ['admin', '/portal/pagos/nuevo?adult=unknown-user', []],
  ];
  for (const [role, path, ids] of cases) {
    const response = await request(path, role);
    assert.equal(response.status, 200);
    privateHeaders(response);
    expectAthletes(await response.text(), ids);
  }
});

await checked('original PNG is saved before OCR; ownership, origin and hashes are enforced', async () => {
  redirect(await post('/api/admin/charges', 'admin', new URLSearchParams({ action: 'publish', month: period })), 'month_published');
  const all = (await exported('charges')).filter(charge => charge.period === period);
  const html = await (await request('/portal/pagos/nuevo', 'parent-a')).text();
  const allowed = new Set(Array.from(html.matchAll(/name="allocationChargeId\[\]"[^>]*value="([^"]+)"/g), match => match[1]));
  const family = all.filter(charge => allowed.has(charge.id) && charge.base_minor - charge.discount_minor + charge.adjustments_minor - charge.paid_minor >= 100_000);
  assert.ok(family.length >= 2, 'The future month needs two linked synthetic sibling charges');
  claims = family.slice(0, 2).map(charge => [charge.id, 1000]);
  beforePaid = Object.fromEntries(family.map(charge => [charge.id, charge.paid_minor]));
  beforeReceiptCount = (await exported('receipts')).length;
  beforeEmailCount = (await exported('email')).length;
  pngDraft = await upload(png, 'image/png');
  const path = `/api/portal/slips/${pngDraft.id}/extract`;
  await expectError(await post(path, 'parent-b', new FormData()), 404, 'draft_not_found');
  await expectError(await post(path, 'unrelated', new FormData()), 404, 'draft_not_found');
  for (const origin of [null, 'https://unrelated.example']) {
    await expectError(await request(path, 'parent-a', { method: 'POST', headers: { accept: 'application/json', ...(origin ? { origin } : {}) }, body: new FormData() }), 403);
  }
  await expectError(await post(path, 'parent-a', fileForm(png, 'image/png', 'ocrImage')), 400, 'invalid_image');
  await expectError(await post('/api/portal/payments', 'parent-a', paymentForm(pngDraft, 'wrong-original', { bytes: jpeg, type: 'image/jpeg' })), 400, 'draft_mismatch');
  await expectError(await post('/api/portal/payments', 'unrelated', paymentForm(pngDraft, 'other-family')), 404, 'draft_not_found');
  pngExtraction = await extract(pngDraft);
  assert.equal(pngExtraction.sourceKind, 'original');
  assert.equal(pngExtraction.sourceSha256, sha(png));
  assert.equal((await extract(pngDraft)).id, pngExtraction.id, 'Repeated reading of identical evidence uses the saved extraction');
  await unchangedLedger();
});

try {
await checked('parent edits OCR fields; submitted amount stays pending and exact PNG remains private', async () => {
  const url = redirect(await post('/api/portal/payments', 'parent-a', paymentForm(pngDraft, 'initial', { bytes: png, type: 'image/png' })), 'submitted');
  paymentId = url.pathname.split('/').at(-1);
  assert.match(paymentId, /^[a-f0-9-]{36}$/);
  const row = await paymentRow();
  assert.equal(row.status, 'pending');
  assert.equal(row.payer_name, financialFields.payerName);
  assert.equal(row.amount_minor, 300_037, 'The parent can correct the demo suggestion without financial coercion');
  assert.equal(row.bank_reference, reference('initial'));
  assert.equal(row.verified_amount_minor, null);
  await expectError(await post('/api/portal/payments', 'parent-a', paymentForm(pngDraft, 'reuse')), 409, 'draft_expired');
  await expectError(await post(`/api/portal/slips/${pngDraft.id}/extract`, 'parent-a', new FormData()), 409, 'draft_expired');
  const html = await (await request(`/portal/pagos/${paymentId}`, 'parent-a')).text();
  originalFiles = fileIds(html);
  assert.equal(originalFiles.length, 1);
  await exactFile(originalFiles[0], png, 'image/png');
  await exactFile(originalFiles[0], png, 'image/png', true);
  await expectError(await request(`/api/portal/files/${originalFiles[0]}?view=inline`), 401);
  for (const role of ['parent-b', 'unrelated']) {
    assert.equal((await request(`/portal/pagos/${paymentId}`, role)).status, 404);
    assert.equal((await request(`/api/portal/files/${originalFiles[0]}?view=inline`, role)).status, 404);
  }
  const adminHtml = await (await request(`/admin/pagos/${paymentId}`, 'admin')).text();
  assert.match(adminHtml, /Lectura simulada/);
  assert.match(adminHtml, /Datos ficticios de demostración; no corresponden al archivo/);
  assert.match(adminHtml, /12000\.00/);
  assert.match(adminHtml, /Difiere del dato registrado/);
  assert.match(adminHtml, /Esta lectura no confirma que el dinero haya ingresado/);
  assert.match(adminHtml, /En revisión/);
  await unchangedLedger();
});

await checked('JPEG revision keeps the prior original and the per-file OCR suggestions', async () => {
  redirect(await post(`/api/admin/payments/${paymentId}/review`, 'admin', new URLSearchParams({ action: 'needs_info', expectedRevision: '1', expectedStatus: 'pending', expectedReviewNote: (await paymentRow()).review_note ?? '', reason: 'Solicitud sintética de un respaldo revisado.' })), 'needs_info');
  for (const role of ['parent-a', 'admin']) {
    const page = await request(`/portal/pagos/${paymentId}`, role);
    assert.equal(page.status, 200);
    expectAthletes(await page.text(), ['demo-athlete-1', 'demo-athlete-2']);
  }
  jpegDraft = await upload(jpeg, 'image/jpeg');
  jpegExtraction = await extract(jpegDraft);
  assert.equal(jpegExtraction.sourceKind, 'original');
  assert.equal(jpegExtraction.sourceSha256, sha(jpeg));
  redirect(await post(`/api/portal/payments/${paymentId}/revise`, 'parent-a', paymentForm(jpegDraft, 'jpeg', { expectedRevision: 1, expectedReviewNote: (await paymentRow()).review_note, note: 'Versión sintética JPEG; el original anterior debe conservarse.' })), 'revised');
  const html = await (await request(`/portal/pagos/${paymentId}`, 'parent-a')).text();
  const ids = fileIds(html);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes(originalFiles[0]));
  const newId = ids.find(id => !originalFiles.includes(id));
  await exactFile(newId, jpeg, 'image/jpeg', true);
  await exactFile(originalFiles[0], png, 'image/png');
  originalFiles.unshift(newId);
  const adminHtml = await (await request(`/admin/pagos/${paymentId}`, 'admin')).text();
  assert.ok((adminHtml.match(/Lectura simulada/g) || []).length >= 2);
  assert.match(adminHtml, /Versión 1/);
  assert.match(adminHtml, /Versión 2/);
  assert.equal((await paymentRow()).status, 'pending');
  await unchangedLedger();
});

await checked('PDF reading requires a bounded image; full PDF original stays an attachment', async () => {
  redirect(await post(`/api/admin/payments/${paymentId}/review`, 'admin', new URLSearchParams({ action: 'needs_info', expectedRevision: '2', expectedStatus: 'pending', expectedReviewNote: (await paymentRow()).review_note ?? '', reason: 'Solicitud sintética del PDF completo.' })), 'needs_info');
  expectAthletes(await (await request(`/portal/pagos/${paymentId}`, 'parent-a')).text(), ['demo-athlete-1', 'demo-athlete-2']);
  pdfDraft = await upload(pdf, 'application/pdf');
  const path = `/api/portal/slips/${pdfDraft.id}/extract`;
  await expectError(await post(path, 'parent-a', new FormData()), 400, 'ocr_pdf_preview_required');
  await expectError(await post(path, 'parent-a', fileForm(pdf, 'application/pdf', 'ocrImage')), 400, 'invalid_image');
  const oversize = Buffer.alloc(1_572_865); png.copy(oversize);
  await expectError(await post(path, 'parent-a', fileForm(oversize, 'image/png', 'ocrImage')), 400, 'invalid_image');
  pdfExtraction = await extract(pdfDraft, fileForm(png, 'image/png', 'ocrImage'));
  assert.equal(pdfExtraction.sourceKind, 'pdf_preview');
  assert.equal(pdfExtraction.sourceSha256, sha(png));
  assert.notEqual(pdfDraft.sha256, pdfExtraction.sourceSha256);
  redirect(await post(`/api/portal/payments/${paymentId}/revise`, 'parent-a', paymentForm(pdfDraft, 'pdf', { expectedRevision: 2, expectedReviewNote: (await paymentRow()).review_note, bytes: pdf, type: 'application/pdf', note: 'Versión sintética PDF completo de dos páginas.' })), 'revised');
  const html = await (await request(`/portal/pagos/${paymentId}`, 'parent-a')).text();
  const ids = fileIds(html);
  assert.equal(ids.length, 3);
  const newId = ids.find(id => !originalFiles.includes(id));
  await exactFile(newId, pdf, 'application/pdf');
  await exactFile(newId, pdf, 'application/pdf', true);
  await exactFile(originalFiles[0], jpeg, 'image/jpeg');
  await exactFile(originalFiles[1], png, 'image/png');
  originalFiles.unshift(newId);
  const adminHtml = await (await request(`/admin/pagos/${paymentId}`, 'admin')).text();
  assert.ok((adminHtml.match(/Lectura simulada/g) || []).length >= 3);
  for (const revision of [1, 2, 3]) assert.match(adminHtml, new RegExp(`Versión ${revision}`));
  assert.match(adminHtml, /Lectura de la primera página convertida a imagen/);
  assert.match(adminHtml, /PDF original/);
  assert.equal((await paymentRow()).bank_reference, reference('pdf'));
  assert.equal((await paymentRow()).amount_minor, 300_037);
  await unchangedLedger();
});

await checked('synthetic pending payment is rejected; no bank approval, receipt or external email occurs', async () => {
  redirect(await post(`/api/admin/payments/${paymentId}/review`, 'admin', new URLSearchParams({ action: 'reject', expectedRevision: '3', expectedStatus: 'pending', expectedReviewNote: (await paymentRow()).review_note ?? '', reason: 'Cierre de prueba OCR sintética: no corresponde a una transferencia bancaria real.' })), 'reject');
  assert.equal((await paymentRow()).status, 'rejected');
  await unchangedLedger();
  await exactFile(originalFiles[0], pdf, 'application/pdf');
  await exactFile(originalFiles[1], jpeg, 'image/jpeg');
  await exactFile(originalFiles[2], png, 'image/png');
});
} finally {
  // A failed assertion must also leave no synthetic claim awaiting bank review.
  if (paymentId) {
    try {
      const row = await paymentRow();
      if (['pending', 'needs_info'].includes(row.status)) {
        const html = await (await request(`/admin/pagos/${paymentId}`, 'admin')).text();
        const expectedRevision = html.match(/name="expectedRevision"[^>]*value="(\d+)"/)?.[1];
        assert.ok(expectedRevision);
        redirect(await post(`/api/admin/payments/${paymentId}/review`, 'admin', new URLSearchParams({ action: 'reject', expectedRevision, expectedStatus: row.status, expectedReviewNote: row.review_note ?? '', reason: 'Cierre de prueba OCR sintética interrumpida; no representa un ingreso bancario.' })), 'reject');
        console.log(`CLEANUP rejected synthetic payment ${paymentId}`);
      }
    } catch {
      console.error(`CLEANUP pending synthetic payment may remain: ${paymentId}`);
    }
  }
}

console.log(JSON.stringify({ result: 'passed', mode: 'demo', providerRequests: 0, paymentId, period, originals: originalFiles.length, timings }, null, 2));

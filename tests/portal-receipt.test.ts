import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceiptSnapshot, DEMO_RECEIPT_NOTICE, STAGING_RECEIPT_NOTICE, renderReceipt, validEmail, RECEIPT_LOGO_PORTAL_SRC, RECEIPT_LOGO_EMAIL_SRC } from '../src/lib/portal/receipt.ts';
import type { ReceiptSnapshot } from '../src/lib/portal/types.ts';

export function receiptFixture(overrides: Partial<ReceiptSnapshot> = {}): ReceiptSnapshot {
  return { version: 1, receiptNumber: 'AB-2026-000001', associationName: 'Asociación Deportiva Belemita de Ajedrez',
    payerName: 'Persona de prueba', paymentDate: '2026-10-08', issuedAt: '2026-10-09T01:30:00.000Z',
    currency: 'CRC', amountMinor: 2_500_000, bankReference: '202610010283002453950810', bankName: 'BAC',
    receivingAccount: 'Cuenta de la Asociación', lines: [
      { athleteId: 'athlete-1', athleteName: 'Atleta de prueba uno', chargeId: 'charge-1', period: '2026-10', amountMinor: 1_200_000 },
      { athleteId: 'athlete-2', athleteName: 'Atleta de prueba dos', chargeId: 'charge-2', period: '2026-10', amountMinor: 1_200_000 },
    ], unallocatedMinor: 100_000,
    designatedAdult: { id: 'adult-1', name: 'Responsable de prueba', email: 'parent@example.invalid' }, demo: false,
    ...overrides };
}

test('issuance snapshot copies and deeply freezes every receipt value', () => {
  const input = receiptFixture();
  const snapshot = createReceiptSnapshot(input);
  input.lines[0]!.athleteName = 'Changed';
  input.designatedAdult.name = 'Changed';
  assert.equal(snapshot.lines[0]!.athleteName, 'Atleta de prueba uno');
  assert.equal(snapshot.designatedAdult.name, 'Responsable de prueba');
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.lines) && Object.isFrozen(snapshot.lines[0]) && Object.isFrozen(snapshot.designatedAdult));
});

test('missing or invalid historical contact email keeps the financial receipt renderable without becoming a valid delivery address', () => {
  const baseline = renderReceipt(receiptFixture());
  for (const email of ['', 'sin-correo', 'parent@', 'a'.repeat(254)]) {
    const input = receiptFixture();
    input.designatedAdult.email = email;
    const snapshot = createReceiptSnapshot(input);
    assert.equal(snapshot.designatedAdult.email, email, 'Preserve the exact historical value');
    assert.equal(validEmail(email), false, 'Delivery validation must remain strict');
    assert.deepEqual(renderReceipt(input), baseline, 'Contact metadata must not block or change the financial document');
    input.designatedAdult.email = 'changed@example.invalid';
    assert.equal(snapshot.designatedAdult.email, email, 'The original snapshot remains frozen');
  }
});

test('historical contact email rejects nonstrings, oversized data, controls and multiline values', () => {
  for (const email of [undefined, null, 42, {}, [], 'a'.repeat(255),
    'parent@example.invalid\r\nBcc:other@example.invalid', 'parent\nother', 'parent\rother',
    'parent\tother', 'parent\u0000other', 'parent\u007fother',
    'parent\u0085other', 'parent\u2028other', 'parent\u2029other']) {
    const input = receiptFixture();
    input.designatedAdult.email = email as unknown as string;
    assert.throws(() => renderReceipt(input), /Invalid receipt snapshot/);
  }
});

test('receipt amounts must equal applied lines plus the unapplied credit', () => {
  assert.throws(() => createReceiptSnapshot(receiptFixture({ amountMinor: 2_400_000 })));
  assert.throws(() => createReceiptSnapshot(receiptFixture({ unallocatedMinor: -1 })));
  const duplicate = receiptFixture();
  duplicate.lines[1]!.chargeId = duplicate.lines[0]!.chargeId;
  assert.throws(() => createReceiptSnapshot(duplicate));
  assert.doesNotThrow(() => createReceiptSnapshot(receiptFixture({ lines: [], unallocatedMinor: 2_500_000 })));
});

test('invalid calendar dates, unsafe totals and unknown currencies cannot issue a receipt', () => {
  for (const overrides of [ { paymentDate: '2026-02-30' }, { issuedAt: '2026-02-30T12:00:00Z' },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'USD' } ]) {
    assert.throws(() => createReceiptSnapshot(receiptFixture(overrides as Partial<ReceiptSnapshot>)));
  }
});

test('receipt escapes personal fields and retains exact long bank reference as text', () => {
  const input = receiptFixture({ payerName: '<img src=x onerror="alert(1)">', associationName: 'A & B <Club>' });
  input.lines[0]!.athleteName = '<script>athlete</script>';
  const output = renderReceipt(input);
  assert.ok(output.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(output.html.includes('&lt;script&gt;athlete&lt;/script&gt;'));
  assert.ok(!output.html.includes('<script>') && !output.html.includes('<img'));
  assert.ok(output.html.includes('202610010283002453950810'));
  assert.ok(output.text.includes('202610010283002453950810'));
  const currency = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.ok(output.text.includes(currency.format(25_000)) && output.text.includes(currency.format(12_000)) && output.text.includes(currency.format(1_000)));
  assert.ok(output.html.includes('@media print'));
});

test('demo receipts and void notices remain clearly marked in both HTML and text', () => {
  const demo = renderReceipt(receiptFixture({ demo: true }));
  assert.ok(demo.html.includes(DEMO_RECEIPT_NOTICE) && demo.text.includes(DEMO_RECEIPT_NOTICE));
  assert.match(demo.subject, /^\[DEMOSTRACIÓN\]/);
  const voided = renderReceipt(receiptFixture(), { voidedAt: '2026-10-10T15:00:00.000Z', voidReason: 'Duplicado <review>' });
  assert.match(voided.subject, /^\[ANULADO\]/);
  assert.ok(voided.html.includes('Duplicado &lt;review&gt;') && voided.text.includes('ANULADO'));
  assert.throws(() => renderReceipt(receiptFixture(), { voidReason: 'Reason without a void timestamp' }));
});

test('receipt production rendering remains unchanged unless staging presentation is explicitly enabled', () => {
  for (const demo of [false, true]) {
    for (const presentation of [{}, { voidedAt: '2026-10-10T15:00:00.000Z', voidReason: 'Duplicado' }]) {
      const input = receiptFixture({ demo });
      const normal = renderReceipt(input, presentation);
      assert.deepEqual(renderReceipt(input, { ...presentation, stagingTest: false }), normal);
      assert.deepEqual(renderReceipt(input, { ...presentation, stagingTest: 'true' as unknown as boolean }), normal);
      for (const content of [normal.html, normal.text]) {
        assert.ok(content.includes('después de verificar el ingreso en la cuenta bancaria.'));
        assert.ok(!content.includes(STAGING_RECEIPT_NOTICE));
      }
    }
  }
});

test('staging receipt warns in HTML and text without mutating the frozen issuance snapshot or financial values', () => {
  const input = receiptFixture();
  input.lines.forEach(Object.freeze);
  Object.freeze(input.lines);
  Object.freeze(input.designatedAdult);
  Object.freeze(input);
  const before = structuredClone(input);
  const normal = renderReceipt(input);
  const staged = renderReceipt(input, { stagingTest: true });
  assert.deepEqual(input, before);
  assert.equal(input.demo, false);
  assert.equal(staged.subject, normal.subject);
  assert.ok(staged.text.startsWith(STAGING_RECEIPT_NOTICE));
  assert.ok(staged.html.indexOf(STAGING_RECEIPT_NOTICE) < staged.html.indexOf('<h1'));
  assert.match(staged.html, /<p style="[^"]*border:3px solid[^\"]*">PRUEBA —/);
  const printRules = staged.html.match(/@media print\{[\s\S]*?<\/style>/)?.[0] ?? '';
  assert.ok(printRules.includes('.print-button{display:none!important}'));
  assert.doesNotMatch(printRules, /(?:p|main|body)\s*\{[^}]*display\s*:\s*none/);
  for (const content of [staged.html, staged.text]) {
    assert.ok(content.includes(STAGING_RECEIPT_NOTICE));
    assert.ok(content.includes('verificación simulada. No se recibieron fondos reales.'));
    assert.ok(!content.includes('después de verificar el ingreso en la cuenta bancaria.'));
    assert.ok(content.includes(input.bankReference));
    assert.ok(content.includes(input.receiptNumber));
    assert.ok(content.includes(input.lines[0]!.athleteName));
  }
  assert.deepEqual(staged.html.match(/<table[\s\S]*?<\/table>/g), normal.html.match(/<table[\s\S]*?<\/table>/g));
});

test('staging, demo and void notices coexist without claiming actual bank confirmation', () => {
  const staged = renderReceipt(receiptFixture({ demo: true }), { stagingTest: true,
    voidedAt: '2026-10-10T15:00:00.000Z', voidReason: 'Prueba duplicada <review>' });
  assert.match(staged.subject, /^\[DEMOSTRACIÓN\] \[ANULADO\]/);
  for (const content of [staged.html, staged.text]) {
    assert.ok(content.includes(STAGING_RECEIPT_NOTICE));
    assert.ok(content.includes(DEMO_RECEIPT_NOTICE));
    assert.ok(content.includes('ANULADO —'));
    assert.ok(content.includes('No se recibieron fondos reales.'));
    assert.ok(!content.includes('después de verificar el ingreso en la cuenta bancaria.'));
  }
  assert.ok(staged.html.includes('Prueba duplicada &lt;review&gt;'));
  assert.ok(staged.text.includes('Prueba duplicada <review>'));
});

test('staging compact print and narrow-screen spacing preserve all receipt content and stay out of production output', () => {
  const input = receiptFixture();
  const normal = renderReceipt(input);
  const staged = renderReceipt(input, { stagingTest: true, voidedAt: '2026-10-10T15:00:00.000Z', voidReason: 'Prueba duplicada' });
  assert.ok(!normal.html.includes('@page'));
  assert.ok(!normal.html.includes('@media screen and (max-width:480px)'), 'staging compact rules stay staging-only');
  assert.ok(normal.html.includes('@media screen and (max-width:560px)'), 'production receipts still fit phone screens');
  assert.ok(staged.html.includes('@page{margin:12mm}'));
  assert.ok(staged.html.includes('@media screen and (max-width:480px)'));
  assert.ok(staged.html.includes('table{table-layout:fixed}'));
  assert.ok(staged.html.includes('break-before:avoid'));
  assert.ok(staged.html.includes('PRUEBA — Datos ficticios. Este documento no acredita un pago real.'));
  assert.ok(staged.html.includes('ANULADO — Prueba duplicada.'));
  assert.ok(staged.html.includes('https://wa.me/50687686102'));
  assert.deepEqual(staged.html.match(/<table[\s\S]*?<\/table>/g), normal.html.match(/<table[\s\S]*?<\/table>/g));
});

test('receipt HTML uses the Portada paper, ink and crest-red palette; the crest is opt-in presentation', () => {
  const rendered = renderReceipt(receiptFixture());
  assert.ok(rendered.html.includes('background:#f3eee3'));
  assert.ok(rendered.html.includes('color:#16130f'));
  assert.ok(rendered.html.includes('border-top:4px solid #b3222b'));
  assert.ok(rendered.html.includes("font-family:'DM Sans',Arial,sans-serif"));
  assert.ok(!rendered.html.includes('<img'), 'no image unless a caller supplies the crest');
  assert.ok(!rendered.html.includes('#f8f6f2') && !rendered.html.includes('#bc312e'));
});

test('receipt header shows the association crest with alt text and fixed size in portal and email forms', () => {
  for (const logoSrc of [RECEIPT_LOGO_PORTAL_SRC, RECEIPT_LOGO_EMAIL_SRC]) {
    const rendered = renderReceipt(receiptFixture(), { logoSrc });
    assert.match(rendered.html, new RegExp(`<img src="${logoSrc.replaceAll('/', '\\/')}" alt="Asociación Deportiva Belemita de Ajedrez" width="72" height="72"`));
    assert.ok(rendered.html.indexOf('<img') < rendered.html.indexOf('<h1'), 'crest leads the document header');
    assert.ok(!rendered.text.includes(logoSrc), 'plain text never carries image markup');
    assert.equal(rendered.subject, renderReceipt(receiptFixture()).subject, 'crest never changes the subject');
  }
  assert.ok(RECEIPT_LOGO_EMAIL_SRC.startsWith('https://') && RECEIPT_LOGO_EMAIL_SRC.endsWith('.png'),
    'email clients need an absolute PNG, not a relative or WebP path');
});

test('receipt rejects untrusted crest sources and back links instead of emitting them', () => {
  for (const logoSrc of ['https://evil.example/logo.png', '/media/../secret.png', 'javascript:alert(1)',
    '/media/crest.svg', 'https://ajedrezbelen.com/media/crest.webp', '/media/crest.png" onerror="alert(1)', 'crest.png', 42]) {
    assert.throws(() => renderReceipt(receiptFixture(), { logoSrc: logoSrc as string }), /Invalid receipt logo/, String(logoSrc));
  }
  assert.throws(() => renderReceipt(receiptFixture(), { portalBackLink: true, backHref: 'https://evil.example' as never }), /Invalid receipt back link/);
});

test('portal receipt offers print and returns each role where it came from; email output never does', () => {
  const family = renderReceipt(receiptFixture(), { portalBackLink: true, logoSrc: RECEIPT_LOGO_PORTAL_SRC });
  assert.match(family.html, /<button type="button" onclick="window\.print\(\)"[^>]*>Imprimir o guardar como PDF<\/button>/);
  assert.match(family.html, /<a href="\/portal"[^>]*>← Volver a mi cuenta<\/a>/);
  const admin = renderReceipt(receiptFixture(), { portalBackLink: true, backHref: '/admin/comprobantes', logoSrc: RECEIPT_LOGO_PORTAL_SRC });
  assert.match(admin.html, /<a href="\/admin\/comprobantes"[^>]*>← Volver a comprobantes<\/a>/);
  const email = renderReceipt(receiptFixture(), { logoSrc: RECEIPT_LOGO_EMAIL_SRC });
  assert.ok(!email.html.includes('window.print') && !email.html.includes('Volver a'), 'mailed receipts carry no portal actions');
});

test('receipt states the applied total and explains a payment with no allocations', () => {
  const currency = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const applied = renderReceipt(receiptFixture());
  assert.ok(applied.html.includes('<tfoot>') && applied.html.includes('Total aplicado'));
  assert.ok(applied.text.includes(`Total aplicado: ${currency.format(24_000)}.`));
  const unapplied = renderReceipt(receiptFixture({ lines: [], unallocatedMinor: 2_500_000 }));
  assert.ok(unapplied.html.includes('Sin aplicación a mensualidades en este comprobante.'));
  assert.ok(unapplied.text.includes('Sin aplicación a mensualidades en este comprobante.'));
  assert.ok(!unapplied.html.includes('<tfoot>'));
  assert.ok(unapplied.text.includes(`Saldo a favor sin aplicar: ${currency.format(25_000)}.`));
});

test('receipt HTML carries a hidden inbox preview without amounts', () => {
  const rendered = renderReceipt(receiptFixture(), { logoSrc: RECEIPT_LOGO_EMAIL_SRC });
  assert.match(rendered.html, /<div aria-hidden="true" style="display:none[^"]*">Comprobante AB-2026-000001 — pago confirmado\.<\/div>/);
  const voided = renderReceipt(receiptFixture(), { voidedAt: '2026-10-10T15:00:00.000Z', voidReason: 'Duplicado' });
  assert.ok(voided.html.includes('Comprobante AB-2026-000001 anulado.'));
});

test('issued, demo and void receipts direct questions to the official WhatsApp without inviting email replies', () => {
  const variants = [renderReceipt(receiptFixture()), renderReceipt(receiptFixture({ demo: true })),
    renderReceipt(receiptFixture(), { voidedAt: '2026-10-10T15:00:00.000Z', voidReason: 'Duplicado' })];
  const notice = 'Correo automático. Las respuestas a este correo no se atienden. Para consultas, escríbenos por WhatsApp.';
  for (const rendered of variants) {
    assert.ok(rendered.html.replace(/<[^>]*>/g, '').includes(notice));
    assert.ok(rendered.text.includes(notice));
    assert.match(rendered.html, /<a href="https:\/\/wa\.me\/50687686102"[^>]*>WhatsApp<\/a>/);
    assert.ok(rendered.text.split('\n').includes('https://wa.me/50687686102'));
  }
});

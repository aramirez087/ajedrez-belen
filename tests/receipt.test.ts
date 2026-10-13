import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceiptSnapshot, PROTOTYPE_RECEIPT_NOTICE, renderReceipt, type ReceiptData } from '../src/lib/receipt.ts';

const sample: ReceiptData = {
  receiptNumber: 'TEST-2026-000001',
  payerName: 'Persona de prueba',
  athleteName: 'Atleta de prueba',
  period: '2026-10',
  amountMinor: 1_200_000,
  discountMinor: 0,
  bankReference: '0000000012345678901234567890',
  transferDate: '2026-10-10',
  issuedAt: '2026-10-11T02:00:00.000Z',
};

test('receipt retains exact bank reference and freezes an independent issuance snapshot', () => {
  const original = { ...sample };
  const snapshot = createReceiptSnapshot(original);
  original.athleteName = 'A subsequently changed name';
  assert.equal(snapshot.athleteName, sample.athleteName);
  assert.equal(snapshot.bankReference, sample.bankReference);
  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => { (snapshot as ReceiptData).amountMinor = 1; }, TypeError);
});

test('HTML escapes dynamic values while the plain-text version preserves their literal text', () => {
  const rendered = renderReceipt({ ...sample, athleteName: '<img src=x onerror="alert(1)"> & prueba', payerName: "O'Prueba" });
  assert.ok(rendered.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; prueba'));
  assert.ok(rendered.html.includes('O&#39;Prueba'));
  assert.ok(!rendered.html.includes('<img'));
  assert.ok(rendered.text.includes('<img src=x onerror="alert(1)"> & prueba'));
  assert.ok(rendered.html.includes(PROTOTYPE_RECEIPT_NOTICE));
  assert.ok(rendered.text.startsWith(PROTOTYPE_RECEIPT_NOTICE));
  assert.match(rendered.subject, /^\[PRUEBA\]/);
});

test('receipt uses Costa Rica dates and displays a manual discount without reducing the paid amount again', () => {
  const rendered = renderReceipt({ ...sample, discountMinor: 300_000 });
  assert.match(rendered.text, /Fecha de emisión: 10 de octubre de 2026/);
  assert.match(rendered.text, /Mensualidad: octubre de 2026/);
  const moneyLine = rendered.text.split('\n').find((line) => line.startsWith('Monto del pago'))!;
  assert.match(moneyLine, /12[.,\s]?000[.,]00/);
  assert.ok(rendered.text.includes('Descuento manual registrado'));
  assert.ok(rendered.text.includes(sample.bankReference));
  assert.ok(!rendered.html.includes('attachment'));
});

test('automated prototype receipt directs questions to the official WhatsApp in HTML and plain text', () => {
  const rendered = renderReceipt(sample);
  const notice = 'Correo automático. Las respuestas a este correo no se atienden. Para consultas, escríbenos por WhatsApp.';
  assert.ok(rendered.html.replace(/<[^>]*>/g, '').includes(notice));
  assert.ok(rendered.text.includes(notice));
  assert.match(rendered.html, /<a href="https:\/\/wa\.me\/50687686102"[^>]*>WhatsApp<\/a>/);
  assert.ok(rendered.text.split('\n').includes('https://wa.me/50687686102'));
  assert.ok(rendered.text.startsWith(PROTOTYPE_RECEIPT_NOTICE));
});

test('invalid money, calendar dates and multiline header values cannot produce a receipt', () => {
  for (const change of [
    { amountMinor: 12.01 }, { amountMinor: 0 }, { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { discountMinor: -1 }, { discountMinor: Number.MAX_SAFE_INTEGER },
    { period: '2026-13' }, { transferDate: '2026-02-30' },
    { issuedAt: '2026-02-30T12:00:00.000Z' }, { issuedAt: 'not a timestamp' },
    { receiptNumber: 'TEST\r\nBcc: victim@example.com' }, { payerName: 'Person\nOther field: forged' },
  ]) {
    assert.throws(() => renderReceipt({ ...sample, ...change }), /Invalid receipt snapshot/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMoney } from '../src/lib/portal/http.ts';
import { minorAmount, allocationSummary } from '../src/lib/portal/allocation-validation.ts';
import { safePortalReturnPath, extractInvitationToken, invitationWhatsAppMessage, invitationWhatsAppUrl, invitationDestination, splitFullName } from '../src/lib/portal/invitation-entry.ts';

test('money accepts the formats Costa Rican families actually type', () => {
  // Canonical / browser number input
  assert.equal(parseMoney('27000'), 2_700_000);
  assert.equal(parseMoney('27000.00'), 2_700_000);
  assert.equal(parseMoney('0.29'), 29);
  // Costa Rica: dot thousands, comma decimals
  assert.equal(parseMoney('27.000'), 2_700_000);
  assert.equal(parseMoney('27.000,50'), 2_700_050);
  assert.equal(parseMoney('1.234.567,89'), 123_456_789);
  assert.equal(parseMoney('15,50'), 1_550);
  // US style pasted from banking apps
  assert.equal(parseMoney('27,000'), 2_700_000);
  assert.equal(parseMoney('27,000.00'), 2_700_000);
  // Currency symbol and spaces from copy-paste
  assert.equal(parseMoney('₡27 000'), 2_700_000);
  assert.equal(parseMoney(' ₡ 27.000 '), 2_700_000);
  // Client-side validation must agree with the server
  assert.equal(minorAmount('27.000'), 2_700_000);
  assert.equal(minorAmount('27,000.00'), 2_700_000);
  assert.equal(minorAmount('15,50'), 1_550);
  assert.deepEqual(allocationSummary(['27.000', '0,00']), { kind: 'ready', totalMinor: 2_700_000 });
});

test('money still rejects ambiguous or malformed amounts', () => {
  for (const value of ['', '₡', 'abc', '-5', '1e3', 'NaN', '1.2345', '12,3456', '1.000.00', '12,34,56', '1..000', '.5', '5.', '0', '0,00', '0.000']) {
    assert.throws(() => parseMoney(value), value);
  }
  for (const value of ['abc', '-5', '1e3', '1.2345', '1.000.00']) {
    assert.equal(minorAmount(value, true), null, value);
  }
  assert.equal(minorAmount('0,00', true), 0, 'zero is allowed for unused allocations');
});

test('post-login return path only ever points inside the family portal', () => {
  assert.equal(safePortalReturnPath('/portal'), '/portal');
  assert.equal(safePortalReturnPath('/portal/pagos/abc-123'), '/portal/pagos/abc-123');
  assert.equal(safePortalReturnPath('/portal/invitacion'), '/portal/invitacion');
  for (const value of [null, undefined, '', 'https://evil.example/portal', '//evil.example', '/\\evil', '/admin', '/portal/acceso', '/portal/../admin', '/portal/%2e%2e/admin', 'portal', '/portal\tevil']) {
    assert.equal(safePortalReturnPath(value as string | null | undefined), null, String(value));
  }
});

test('invitation token can be pasted as a full link or a bare code', () => {
  const token = 'QdSMY4VU0mJDn38x88V0siOoXYGaheRjqEJkR4YIQ50';
  assert.equal(extractInvitationToken(token), token);
  assert.equal(extractInvitationToken(`  ${token}  `), token);
  assert.equal(extractInvitationToken(`https://ajedrezbelen.com/portal/invitacion?token=${token}`), token);
  assert.equal(extractInvitationToken(`Toca este enlace: https://ajedrezbelen.com/portal/invitacion?token=${token} para entrar`), token);
  for (const value of ['', 'hola', 'https://ajedrezbelen.com/portal', 'token=corto']) {
    assert.equal(extractInvitationToken(value), null, value);
  }
});

test('the WhatsApp invitation is one short tap-and-you-are-in line', () => {
  const link = 'https://ajedrezbelen.com/portal/invitacion?token=abc123';
  const message = invitationWhatsAppMessage(link);
  assert.ok(message.includes(link), 'the link itself is the message');
  assert.ok(!message.includes('\n'), 'no multi-line instructions');
  assert.ok(message.length < link.length + 70, `message stays short, got ${message.length} chars`);
  assert.doesNotMatch(message, /inicia sesión|acept|primera vez|paso/i, 'nothing to learn before tapping');
  const share = new URL(invitationWhatsAppUrl(link));
  assert.equal(share.origin + share.pathname, 'https://wa.me/');
  assert.equal(share.searchParams.get('text'), message);
});

test('accepting an invitation lands people where their next job is', () => {
  assert.equal(invitationDestination('register'), '/portal/inscribir');
  assert.equal(invitationDestination('link'), '/portal');
  assert.equal(invitationDestination(null), '/portal');
  assert.equal(invitationDestination(undefined), '/portal');
});

test('registration needs one full-name field, split for the identity provider', () => {
  assert.deepEqual(splitFullName('María José Ramírez Solís'), { firstName: 'María', lastName: 'José Ramírez Solís' });
  assert.deepEqual(splitFullName('  Ana   Mora  '), { firstName: 'Ana', lastName: 'Mora' });
  assert.deepEqual(splitFullName('Madonna'), { firstName: 'Madonna', lastName: '' });
  assert.equal(splitFullName('   '), null);
  assert.equal(splitFullName(''), null);
});

test('every comprobante-flow success notice has a plain-language message', () => {
  const notice = readFileSync(new URL('../src/components/portal/Notice.astro', import.meta.url), 'utf8');
  // Keys the verify/void/reject and email routes can actually redirect with,
  // including the dynamic action names review.ts passes through verbatim.
  for (const code of ['verified', 'verified_email_sent', 'verified_email_dry_run', 'verified_email_pending',
    'verified_email_attention', 'email_prepared', 'email_queued', 'email_processed',
    'email_processed_remaining', 'email_none', 'dry_run', 'needs_info', 'reject', 'rejected', 'void', 'voided']) {
    assert.ok(new RegExp(`\\b${code}:`).test(notice), `Notice.astro is missing a message for ${code}`);
  }
});

test('the receipt document page can actually display its crest and print button', () => {
  const page = readFileSync(new URL('../src/pages/portal/comprobantes/[id].astro', import.meta.url), 'utf8');
  assert.ok(page.includes("img-src 'self'"), 'CSP must allow the same-origin crest or the logo silently never renders');
  assert.ok(page.includes("script-src 'unsafe-inline'"), 'CSP must allow the inline print action');
  assert.ok(page.includes('logoSrc:RECEIPT_LOGO_PORTAL_SRC'), 'the page passes the crest to the renderer');
  assert.ok(page.includes('RECEIPT_LOGO_PORTAL_SRC'), 'the page uses the shared crest constant');
});

test('every error code the server can send has a plain-language message', () => {
  const http = readFileSync(new URL('../src/lib/portal/http.ts', import.meta.url), 'utf8');
  const notice = readFileSync(new URL('../src/components/portal/Notice.astro', import.meta.url), 'utf8');
  const block = http.match(/const errorCodes = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  const codes = [...block.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  assert.ok(codes.length > 30, 'error code list was found');
  for (const code of codes) assert.ok(new RegExp(`\\b${code}:`).test(notice), `Notice.astro is missing a message for ${code}`);
});

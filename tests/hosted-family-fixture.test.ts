import assert from 'node:assert/strict';
import { after, before, mock, test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { APIContext } from 'astro';
import { authorizePortal } from '../src/lib/portal/access';
import {
  enrollAthlete, ensureUser, getMonthlyPreview, getParentDashboard,
  getPaymentDetail, getPaymentFile, getReceipt, linkGuardian,
  publishMonth, reviewPayment, revokeGuardian, submitPayment,
} from '../src/lib/portal/domain';
import { PortalError, type Actor, type SubmitPaymentInput } from '../src/lib/portal/types';

// LOCAL ONLY: SDK-validated identity boundary is injected, never authenticated here.
// This suite proves domain/authorization behavior, not hosted signup or SDK validation.
let networkCalls = 0;
before(() => { mock.method(globalThis, 'fetch', async () => {
  networkCalls++; throw new Error('Provider/network requests are forbidden in this local fixture');
}); });
after(() => { mock.restoreAll(); assert.equal(networkCalls, 0); });

const owner: Actor = { id: 'user_LocalFixtureOwner', email: 'owner@example.invalid', name: 'LOCAL TEST OWNER', isAdmin: true, mode: 'workos' };
const parentA: Actor = { id: 'user_LocalFixtureParentA', email: 'parent-a@example.invalid', name: 'LOCAL TEST PARENT A', isAdmin: false, mode: 'workos' };
const parentB: Actor = { id: 'user_LocalFixtureParentB', email: 'parent-b@example.invalid', name: 'LOCAL TEST PARENT B', isAdmin: false, mode: 'workos' };
const period = '2026-10';
const athleteInput = (name: string) => ({ name, category: 'Iniciación', feeMinor: 1200000, discountMinor: 0, startPeriod: period });
// No restricted staging flag: the candidate's separate policy suite owns that gate.
const environment = {
  PORTAL_ENABLED: 'true', PORTAL_DEMO: 'false', EMAIL_MODE: 'dry_run', OCR_MODE: 'off',
  WORKOS_API_KEY: 'sk_LOCAL_SYNTHETIC_ONLY', WORKOS_CLIENT_ID: 'client_LocalFixture',
  WORKOS_COOKIE_PASSWORD: 'LOCAL_SYNTHETIC_COOKIE_PASSWORD_NOT_A_REAL_SECRET',
  WORKOS_REDIRECT_URI: 'https://portal.example.invalid/auth/callback',
  WORKOS_ORGANIZATION_ID: 'org_LocalFixture', ADMIN_USER_IDS: owner.id,
};

/** Real SQLite constraints and D1's atomic batch convention; nothing is persisted. */
class SQLiteD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  constructor(t: TestContext) {
    t.after(() => this.sqlite.close());
    for (const migration of ['0002_portal.sql', '0004_financial_operations.sql'])
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  prepare(sql: string) {
    const sqlite = this.sqlite;
    let values: Array<string | number | null> = [];
    const statement = {
      bind(...args: Array<string | number | null>) { values = args; return statement; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }; },
      async first(column?: string) {
        const row = sqlite.prepare(sql).get(...values);
        return column ? (row?.[column] ?? null) : (row ?? null);
      },
      async run() { return statement.execute(); },
      execute() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return statement;
  }
  async batch(statements: Array<ReturnType<SQLiteD1['prepare']>>) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map(statement => statement.execute()); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  db() { return this as unknown as D1Database; }
}
async function fixture(t: TestContext, linked = true) {
  const adapter = new SQLiteD1(t), db = adapter.db();
  for (const actor of [owner, parentA, parentB]) await ensureUser(db, actor);
  const athleteA = await enrollAthlete(db, owner, athleteInput('PRUEBA FAMILIA YAHOO A'));
  const athleteB = await enrollAthlete(db, owner, athleteInput('PRUEBA FAMILIA LOCAL B'));
  if (linked) {
    await linkGuardian(db, owner, { userId: parentA.id, athleteId: athleteA });
    await linkGuardian(db, owner, { userId: parentB.id, athleteId: athleteB });
  }
  return { adapter, db, athleteA, athleteB };
}
const denied = (status: number) => (error: unknown) => error instanceof PortalError && error.status === status;
function context(actor: Actor, path = '/portal', organizationId: string | undefined = actor.isAdmin ? environment.WORKOS_ORGANIZATION_ID : undefined) {
  const url = new URL(path, 'https://portal.example.invalid');
  return {
    locals: { auth: {
      user: { id: actor.id, email: actor.email, emailVerified: true, firstName: actor.name, lastName: '' },
      sessionId: 'session_LOCAL_ONLY', accessToken: 'synthetic-SDK-boundary-fixture', organizationId, impersonator: null,
    } }, url, request: new Request(url),
  } as unknown as APIContext;
}
async function privateRecords(f: Awaited<ReturnType<typeof fixture>>) {
  // These financial rows exist only in this in-memory test extension. The hosted
  // proposal creates one athlete/link and does not publish charges or payments.
  const preview = await getMonthlyPreview(f.db, period);
  await publishMonth(f.db, owner, period, preview.snapshot);
  const charge = (await getParentDashboard(f.db, parentB)).charges[0];
  const input: SubmitPaymentInput = {
    submissionId: crypto.randomUUID(), payerName: 'PRUEBA SIN VALOR FINANCIERO',
    amountMinor: 1200000, transferDate: '2026-10-10', bankReference: 'LOCAL-FICTIONAL-REFERENCE',
    allocations: [{ chargeId: charge.id, amountMinor: 1200000 }],
    file: { key: `portal/local-fixture/${crypto.randomUUID()}.pdf`, type: 'application/pdf', size: 100, sha256: 'a'.repeat(64) },
  };
  const paymentId = await submitPayment(f.db, parentB, input);
  const fileId = (await getPaymentDetail(f.db, parentB, paymentId)).files[0].id;
  const receiptId = await reviewPayment(f.db, owner, paymentId, {
    action: 'verify', expectedRevision: 1, expectedStatus: 'pending', expectedReviewNote: null,
    bankChecked: true, associationName: 'Asociación de prueba', bankName: 'BANCO FICTICIO LOCAL', receivingAccount: 'CUENTA FICTICIA LOCAL',
    bankReference: input.bankReference, amountMinor: input.amountMinor, paymentDate: input.transferDate,
    currency: 'CRC', allocations: input.allocations,
  });
  assert.ok(receiptId);
  return { input, paymentId, fileId, receiptId };
}

test('local fixture grants exactly one athlete per explicit guardian link and creates no financial records', async t => {
  const f = await fixture(t, false);
  for (const parent of [parentA, parentB]) assert.equal((await getParentDashboard(f.db, parent)).athletes.length, 0);
  await linkGuardian(f.db, owner, { userId: parentA.id, athleteId: f.athleteA });
  await linkGuardian(f.db, owner, { userId: parentB.id, athleteId: f.athleteB });
  for (const [parent, athleteId] of [[parentA, f.athleteA], [parentB, f.athleteB]] as const) {
    const dashboard = await getParentDashboard(f.db, parent);
    assert.deepEqual(dashboard.athletes.map(athlete => athlete.id), [athleteId]);
    assert.equal(dashboard.athletes[0].feeMinor, 1200000);
    assert.equal(dashboard.athletes[0].discountMinor, 0);
    assert.equal(dashboard.balanceMinor, 0);
    assert.equal(dashboard.charges.length + dashboard.payments.length + dashboard.receipts.length, 0);
  }
  for (const table of ['charges', 'payments', 'payment_files', 'receipts', 'email_outbox', 'invitations'])
    assert.equal(f.adapter.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
  assert.equal(f.adapter.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='link_guardian'").get()!.n, 2);
});

test('real foreign payment, original metadata and receipt stay private while intended parent and owner can read', async t => {
  const f = await fixture(t), records = await privateRecords(f);
  for (const actor of [parentB, owner]) {
    assert.equal((await getPaymentDetail(f.db, actor, records.paymentId)).payment.id, records.paymentId);
    assert.equal((await getPaymentFile(f.db, actor, records.fileId)).paymentId, records.paymentId);
    assert.equal((await getReceipt(f.db, actor, records.receiptId)).paymentId, records.paymentId);
  }
  await assert.rejects(getPaymentDetail(f.db, parentA, records.paymentId), denied(404));
  await assert.rejects(getPaymentFile(f.db, parentA, records.fileId), denied(404));
  await assert.rejects(getReceipt(f.db, parentA, records.receiptId), denied(404));
  await assert.rejects(submitPayment(f.db, parentA, { ...records.input, submissionId: crypto.randomUUID() }), denied(403));
  const dashboard = await getParentDashboard(f.db, parentA);
  assert.deepEqual(dashboard.charges.map(charge => charge.athleteId), [f.athleteA]);
  assert.equal(dashboard.balanceMinor, 1200000);
  assert.equal(dashboard.payments.length + dashboard.receipts.length, 0);
  assert.equal(f.adapter.sqlite.prepare('SELECT count(*) AS n FROM payments').get()!.n, 1);
  assert.deepEqual(f.adapter.sqlite.prepare('SELECT recipient_id,recipient_email FROM email_outbox').all().map(row => ({ ...row })), [{ recipient_id: parentB.id, recipient_email: parentB.email }]);
});

test('existing local session loses linked data immediately and inactive account loses even its retained original', async t => {
  const f = await fixture(t), records = await privateRecords(f), ctx = context(parentB);
  const env = { ...environment, DB: f.db } as Cloudflare.Env;
  assert.ok((await authorizePortal(ctx, env)).ok);
  await revokeGuardian(f.db, owner, { userId: parentB.id, athleteId: f.athleteB });
  assert.ok((await authorizePortal(ctx, env)).ok, 'Account remains authenticated after link revocation');
  const dashboard = await getParentDashboard(f.db, parentB);
  assert.equal(dashboard.athletes.length + dashboard.charges.length + dashboard.receipts.length, 0);
  assert.equal(dashboard.payments[0].canOpenDetail, false);
  await assert.rejects(getPaymentDetail(f.db, parentB, records.paymentId), denied(404));
  await assert.rejects(getReceipt(f.db, parentB, records.receiptId), denied(404));
  assert.equal((await getPaymentFile(f.db, parentB, records.fileId)).id, records.fileId, 'Active uploader retains their own raw evidence by existing policy');
  f.adapter.sqlite.prepare('UPDATE users SET active=0 WHERE id=?').run(parentB.id);
  const inactive = await authorizePortal(ctx, env);
  assert.equal(inactive.ok, false);
  if (!inactive.ok) assert.equal(inactive.response.status, 403);
  for (const operation of [
    () => getParentDashboard(f.db, parentB), () => getPaymentDetail(f.db, parentB, records.paymentId),
    () => getPaymentFile(f.db, parentB, records.fileId), () => getReceipt(f.db, parentB, records.receiptId),
  ]) await assert.rejects(operation(), denied(403));
  assert.equal(f.adapter.sqlite.prepare('SELECT active FROM users WHERE id=?').get(parentB.id)!.active, 0);
  assert.deepEqual((await getParentDashboard(f.db, parentA)).athletes.map(athlete => athlete.id), [f.athleteA]);
});

test('shared endpoint authorization denies non-admin or invalid identities before touching DB or storage', async t => {
  let bindingTouches = 0;
  const forbidden = new Proxy({}, { get() { bindingTouches++; throw new Error('Forbidden binding touched'); } });
  const env = { ...environment, DB: forbidden, SLIPS: forbidden } as Cloudflare.Env;
  for (const path of ['/admin', '/api/admin/export', '/api/admin/links']) {
    for (const actor of [parentA, parentB]) {
      const result = await authorizePortal(context(actor, path, environment.WORKOS_ORGANIZATION_ID), env, { admin: true });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 403);
    }
  }
  const wrongOrganization = await authorizePortal(context(owner, '/api/admin/export', 'org_Foreign'), env, { admin: true });
  assert.equal(wrongOrganization.ok, false);
  if (!wrongOrganization.ok) assert.equal(wrongOrganization.response.status, 403);
  const invalid = context(parentA, '/api/portal/payments');
  invalid.locals.auth!.user!.emailVerified = false;
  const deniedIdentity = await authorizePortal(invalid, env);
  assert.equal(deniedIdentity.ok, false);
  if (!deniedIdentity.ok) assert.equal(deniedIdentity.response.status, 401);
  assert.equal(bindingTouches, 0);
  await assert.rejects(enrollAthlete(forbidden as D1Database, parentA, athleteInput('LOCAL UNAUTHORIZED')), denied(403));
  await assert.rejects(linkGuardian(forbidden as D1Database, parentA, { userId: parentA.id, athleteId: 'fictional-target' }), denied(403));
  assert.equal(bindingTouches, 0, 'Domain admin guards also run before database access');
  const f = await fixture(t);
  const allowed = await authorizePortal(context(owner, '/admin'), { ...environment, DB: f.db } as Cloudflare.Env, { admin: true });
  assert.ok(allowed.ok && allowed.actor.isAdmin);
});

import assert from 'node:assert/strict';
import { after, before, mock, test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { APIContext } from 'astro';
import { authorizePortal, getPortalIdentity } from '../src/lib/portal/access';
import { getParentDashboard } from '../src/lib/portal/domain';

let networkCalls = 0;
before(() => { mock.method(globalThis, 'fetch', async () => { networkCalls++; throw new Error('Network forbidden in synthetic parent tests'); }); });
after(() => { mock.restoreAll(); assert.equal(networkCalls, 0); });
const environment = {
  PORTAL_ENABLED: 'true', PORTAL_DEMO: 'false', EMAIL_MODE: 'dry_run', OCR_MODE: 'off',
  WORKOS_API_KEY: 'sk_SYNTHETIC_ONLY', WORKOS_CLIENT_ID: 'client_synthetic',
  WORKOS_COOKIE_PASSWORD: 'SYNTHETIC_LOCAL_COOKIE_PASSWORD_NOT_A_SECRET',
  WORKOS_REDIRECT_URI: 'https://portal.example.invalid/auth/callback',
  WORKOS_ORGANIZATION_ID: 'org_synthetic_staff', ADMIN_USER_IDS: 'user_synthetic_staff',
};
function auth(id = 'user_parent_a', organizationId: string | undefined = undefined) {
  return { user: { id, email: `${id}@example.invalid`, emailVerified: true, firstName: 'Synthetic', lastName: 'Parent' },
    sessionId: 'synthetic-verified-session', accessToken: 'synthetic-SDK-verified-token', organizationId, impersonator: null };
}
function context(identity: unknown = auth(), path = '/portal', method = 'GET') {
  const url = new URL(path, 'https://portal.example.invalid');
  return { locals: { auth: identity }, url, request: new Request(url, { method }) } as APIContext;
}
function fixture(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../migrations/0002_portal.sql', import.meta.url), 'utf8'));
  const at = '2026-10-01T00:00:00.000Z';
  for (const id of ['user_parent_a', 'user_parent_b', 'user_synthetic_staff']) {
    sqlite.prepare('INSERT INTO users(id,email,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, `${id}@example.invalid`, id, at, at);
  }
  for (const id of ['athlete_a', 'athlete_shared', 'athlete_b']) {
    sqlite.prepare('INSERT INTO athletes(id,name,category,fee_minor,start_period,created_at,updated_at) VALUES(?,?,?,1200000,?,?,?)')
      .run(id, id, 'Synthetic', '2026-10', at, at);
    sqlite.prepare('INSERT INTO charges(id,athlete_id,period,due_date,base_minor,discount_minor,published_by,created_at) VALUES(?,?,?, ?,1200000,0,?,?)')
      .run(`charge_${id}`, id, '2026-10', '2026-10-08', 'user_synthetic_staff', at);
  }
  for (const [user, athlete] of [['user_parent_a', 'athlete_a'], ['user_parent_a', 'athlete_shared'], ['user_parent_b', 'athlete_b'], ['user_parent_b', 'athlete_shared']]) {
    sqlite.prepare('INSERT INTO guardian_links(user_id,athlete_id,linked_by,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(user, athlete, 'user_synthetic_staff', at, at);
  }
  const queries: string[] = [];
  const db = { prepare(sql: string) {
    queries.push(sql);
    return { bind(...values: Array<string | number | null>) {
      return {
        async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }; },
      };
    } };
  } } as unknown as D1Database;
  return { sqlite, queries, env: { ...environment, DB: db } as Cloudflare.Env };
}

test('verified parent sessions without staff membership see only their current linked athletes and balances', async t => {
  const f = fixture(t);
  for (const [id, organization, expected] of [
    ['user_parent_a', undefined, ['athlete_a', 'athlete_shared']],
    ['user_parent_b', 'org_other', ['athlete_b', 'athlete_shared']],
  ] as const) {
    const access = await authorizePortal(context(auth(id, organization)), f.env);
    assert.ok(access.ok);
    assert.equal(access.actor.isAdmin, false);
    assert.equal(access.actor.mode, 'workos');
    const dashboard = await getParentDashboard(f.env.DB, access.actor);
    assert.deepEqual(dashboard.athletes.map(athlete => athlete.id).sort(), [...expected].sort());
    assert.deepEqual(dashboard.charges.map(charge => charge.athleteId).sort(), [...expected].sort());
    assert.equal(dashboard.balanceMinor, 2400000);
  }
});

test('a current authenticated session cannot restore inactive accounts or revoked guardian links', async t => {
  const f = fixture(t), ctx = context();
  const first = await authorizePortal(ctx, f.env);
  assert.ok(first.ok);
  f.sqlite.prepare('UPDATE guardian_links SET active=0,receipt_opt_in=0 WHERE user_id=? AND athlete_id=?').run('user_parent_a', 'athlete_shared');
  const afterRevocation = await authorizePortal(ctx, f.env);
  assert.ok(afterRevocation.ok);
  const dashboard = await getParentDashboard(f.env.DB, afterRevocation.actor);
  assert.deepEqual(dashboard.athletes.map(athlete => athlete.id), ['athlete_a']);
  assert.equal(dashboard.balanceMinor, 1200000);
  f.sqlite.prepare('UPDATE users SET active=0 WHERE id=?').run('user_parent_a');
  const inactive = await authorizePortal(ctx, f.env);
  assert.equal(inactive.ok, false);
  if (!inactive.ok) assert.equal(inactive.response.status, 403);
  assert.equal(f.sqlite.prepare('SELECT active FROM users WHERE id=?').get('user_parent_a')!.active, 0);
  await assert.rejects(getParentDashboard(f.env.DB, first.actor), (error: unknown) => (error as { status: number }).status === 403);
});

test('verified ordinary parents and wrong-organization allowlisted users cannot reach admin data', async t => {
  const f = fixture(t);
  for (const identity of [auth(), auth('user_parent_a', 'org_synthetic_staff'), auth('user_synthetic_staff'), auth('user_synthetic_staff', 'org_other')]) {
    const denied = await authorizePortal(context(identity, '/api/admin/invitations', 'POST'), f.env, { admin: true });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.response.status, 403);
  }
  assert.deepEqual(f.queries, [], 'Admin denial happens before user synchronization or business access');
  const allowed = await authorizePortal(context(auth('user_synthetic_staff', 'org_synthetic_staff'), '/admin'), f.env, { admin: true });
  assert.ok(allowed.ok && allowed.actor.isAdmin);
});

test('unverified, missing-token and impersonated parent sessions fail before database access', async t => {
  const f = fixture(t), valid = auth();
  assert.equal(getPortalIdentity(context(null), f.env), null);
  assert.equal(getPortalIdentity(context({ user: null }), f.env), null);
  for (const identity of [
    { ...valid, user: { ...valid.user, emailVerified: false } },
    { ...valid, sessionId: '' }, { ...valid, accessToken: '' },
    { ...valid, impersonator: { email: 'synthetic-support@example.invalid' } },
  ]) {
    assert.equal(getPortalIdentity(context(identity), f.env), null);
    const api = await authorizePortal(context(identity, '/api/portal/invitations/redeem', 'POST'), f.env);
    assert.equal(api.ok, false);
    if (!api.ok) assert.equal(api.response.status, 401);
    const page = await authorizePortal(context(identity), f.env);
    assert.equal(page.ok, false);
    if (!page.ok) { assert.equal(page.response.status, 302); assert.equal(page.response.headers.get('Location'), '/portal/acceso'); }
  }
  assert.deepEqual(f.queries, []);
});

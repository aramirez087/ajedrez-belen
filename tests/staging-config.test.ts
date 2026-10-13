import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateConfig } from '../scripts/staging-policy.mjs';

// Read only the reviewed public configuration. Never load local environment files.
const source = JSON.parse(readFileSync(new URL('../wrangler.staging.jsonc', import.meta.url), 'utf8'));
const expectedIdentity = {
  WORKOS_CLIENT_ID: 'client_01M4M8D1P0W2N2WANHTC4SF921',
  WORKOS_ORGANIZATION_ID: 'org_01M4MK3YVA8B4WC0F659G28MCJ',
  ADMIN_USER_IDS: 'user_01M4MJY2GGNK2GTTH9AYRDTP78',
  WORKOS_REDIRECT_URI: 'https://ajedrez-belen-portal-staging.alexramirez-cr.workers.dev/auth/callback',
};
const expectedParent = {
  STAGING_PARENT_TEST: 'true',
  STAGING_PARENT_EMAIL: 'alexramirez_cr@yahoo.com',
  STAGING_PARENT_USER_ID: 'user_01M4P8D7B09WZD8A27CB7MG72P',
};

function rejectVariable(name: string, value: unknown) {
  const changed = structuredClone(source);
  changed.vars[name] = value;
  assert.throws(() => validateConfig(changed), `Reject ${name} mutation`);
}

test('reviewed staging source pins the sole administrator and exact approved non-admin parent separately', () => {
  assert.doesNotThrow(() => validateConfig(source));
  assert.equal(source.vars.STAGING_AUTH_SETUP, 'true');
  assert.equal(source.vars.STAGING_PORTAL_TEST, 'true');
  assert.equal(source.vars.PORTAL_ENABLED, 'true');
  for (const [name, value] of Object.entries(expectedIdentity)) assert.equal(source.vars[name], value, name);
  for (const [name, value] of Object.entries(expectedParent)) assert.equal(source.vars[name], value, name);
  assert.notEqual(source.vars.STAGING_PARENT_USER_ID, source.vars.ADMIN_USER_IDS);
  for (const name of ['PROTOTYPE_ENABLED', 'PROTOTYPE_LOCAL', 'PORTAL_DEMO']) {
    assert.equal(source.vars[name], 'false', name);
  }
  assert.equal(source.vars.EMAIL_MODE, 'dry_run');
  assert.equal(source.vars.OCR_MODE, 'off');
});

test('active parent configuration rejects removed, substituted or ambiguous ID and email pins', () => {
  for (const [name, alternatives] of Object.entries({
    STAGING_PARENT_TEST: ['false', true, false],
    STAGING_PARENT_EMAIL: ['other@example.test', 'Alexramirez_cr@yahoo.com', 'alexramirez_cr@yahoo.com '],
    STAGING_PARENT_USER_ID: ['user_other', expectedIdentity.ADMIN_USER_IDS, 'user_01M4P8D7B09WZD8A27CB7MG72P '],
  })) {
    for (const value of [...alternatives, '', null, undefined]) rejectVariable(name, value);
    const missing = structuredClone(source);
    delete missing.vars[name];
    assert.throws(() => validateConfig(missing), `Reject missing ${name}`);
  }
});

test('the approved Yahoo test identity cannot become an administrator through deployment config', () => {
  rejectVariable('ADMIN_USER_IDS', expectedParent.STAGING_PARENT_USER_ID);
  rejectVariable('ADMIN_USER_IDS', `${expectedIdentity.ADMIN_USER_IDS},${expectedParent.STAGING_PARENT_USER_ID}`);
  rejectVariable('WORKOS_ORGANIZATION_ID', '');
});

test('staging policy rejects changed or missing owner, organization, client and callback', () => {
  const alternatives = {
    WORKOS_CLIENT_ID: 'client_fixture',
    WORKOS_ORGANIZATION_ID: 'org_fixture',
    ADMIN_USER_IDS: 'user_fixture',
    WORKOS_REDIRECT_URI: 'https://unrelated.example/auth/callback',
  };
  for (const [name, value] of Object.entries(alternatives)) {
    rejectVariable(name, value);
    rejectVariable(name, '');
    rejectVariable(name, null);
    const missing = structuredClone(source);
    delete missing.vars[name];
    assert.throws(() => validateConfig(missing), `Reject missing ${name}`);
  }
});

test('staging policy rejects extra administrators and callback variants', () => {
  for (const admins of [
    `${expectedIdentity.ADMIN_USER_IDS},user_fixture`,
    `user_fixture,${expectedIdentity.ADMIN_USER_IDS}`,
    `${expectedIdentity.ADMIN_USER_IDS},${expectedIdentity.ADMIN_USER_IDS}`,
    `${expectedIdentity.ADMIN_USER_IDS} `,
    '*',
  ]) rejectVariable('ADMIN_USER_IDS', admins);
  for (const callback of [
    'http://127.0.0.1:4325/auth/callback',
    expectedIdentity.WORKOS_REDIRECT_URI.replace('https:', 'http:'),
    `${expectedIdentity.WORKOS_REDIRECT_URI}/`,
    `${expectedIdentity.WORKOS_REDIRECT_URI}?returnTo=https://unrelated.example`,
    `${expectedIdentity.WORKOS_REDIRECT_URI}#fragment`,
    expectedIdentity.WORKOS_REDIRECT_URI.replace('https://', 'https://user:password@'),
  ]) rejectVariable('WORKOS_REDIRECT_URI', callback);
});

test('staging policy forbids secret values in source variables, including empty secret placeholders', () => {
  for (const name of ['WORKOS_API_KEY', 'WORKOS_COOKIE_PASSWORD', 'BREVO_API_KEY', 'CLOUDFLARE_API_TOKEN']) {
    rejectVariable(name, 'synthetic-secret-must-not-be-in-config');
    rejectVariable(name, '');
  }
  rejectVariable('UNREVIEWED_SETTING', 'synthetic');
});

test('staging policy rejects public activation, alternate mail/OCR modes and non-string flag coercion', () => {
  for (const name of ['PROTOTYPE_ENABLED', 'PROTOTYPE_LOCAL', 'PORTAL_DEMO']) {
    for (const value of ['true', true, false, 'FALSE', ' false']) rejectVariable(name, value);
  }
  for (const flag of ['STAGING_AUTH_SETUP', 'STAGING_PORTAL_TEST', 'PORTAL_ENABLED']) {
    for (const value of ['false', true, false, undefined]) rejectVariable(flag, value);
  }
  for (const value of ['brevo', 'live', '', undefined]) rejectVariable('EMAIL_MODE', value);
  for (const value of ['demo', 'cloudflare', 'on', '', undefined]) rejectVariable('OCR_MODE', value);
});

test('staging policy prevents deployment routes, preview URLs and environment overrides', () => {
  for (const [name, value] of Object.entries({
    routes: [{ pattern: 'ajedrezbelen.com/*', zone_name: 'ajedrezbelen.com' }],
    route: 'ajedrezbelen.com/*',
    env: { production: { vars: { PORTAL_ENABLED: 'true' } } },
    triggers: { crons: ['* * * * *'] },
    services: [{ binding: 'UNREVIEWED', service: 'other-worker' }],
    build: { command: 'unreviewed-command' },
  })) {
    const changed = { ...structuredClone(source), [name]: value };
    assert.throws(() => validateConfig(changed), `Reject ${name}`);
  }
  for (const [name, value] of Object.entries({ workers_dev: false, preview_urls: true, name: 'ajedrez-belen' })) {
    assert.throws(() => validateConfig({ ...structuredClone(source), [name]: value }), `Reject ${name}`);
  }
});

test('staging policy refuses extra or substituted database and file-storage bindings', () => {
  const otherId = structuredClone(source);
  otherId.d1_databases[0].database_id = '00000000-0000-4000-8000-000000000001';
  assert.throws(() => validateConfig(otherId));
  const otherDatabase = structuredClone(source);
  otherDatabase.d1_databases[0].database_name = 'production-payments';
  assert.throws(() => validateConfig(otherDatabase));
  const extraDatabase = structuredClone(source);
  extraDatabase.d1_databases.push({ ...source.d1_databases[0], binding: 'OTHER_DB' });
  assert.throws(() => validateConfig(extraDatabase));
  const otherBucket = structuredClone(source);
  otherBucket.r2_buckets[0].bucket_name = 'production-slips';
  assert.throws(() => validateConfig(otherBucket));
  const extraBucket = structuredClone(source);
  extraBucket.r2_buckets.push({ binding: 'PUBLIC_FILES', bucket_name: 'unreviewed' });
  assert.throws(() => validateConfig(extraBucket));
});

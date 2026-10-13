// Synthetic inputs only. No subprocess, capture, browser or provider call.
import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { classifyWranglerFailure, sanitizedFailureDiagnostic } from './backup-diagnostics.mjs';

const privateMarker = 'PRIVATE_TEST_MARKER_owner@example.invalid_/private/path?token=synthetic';
const fail = (text, code) => ({ status: 1, stdout: JSON.stringify({ error: { text, ...(code ? { code } : {}) } }), stderr: '' });
let fetches = 0;
before(() => mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('Network forbidden'); }));
after(() => { mock.restoreAll(); assert.equal(fetches, 0); });

test('spawn error codes identify local files, storage, timeout and bounded output without provider assumptions', () => {
  for (const [code, category, layer] of [
    ['EACCES','local_access_denied','local_filesystem'], ['EPERM','local_access_denied','local_filesystem'],
    ['EROFS','local_access_denied','local_filesystem'], ['ENOENT','local_file_missing','local_filesystem'],
    ['ENOTDIR','local_file_missing','local_filesystem'], ['ENOSPC','local_storage_full','local_filesystem'],
    ['ETIMEDOUT','command_timeout','local_command'], ['ENOBUFS','output_limit_exceeded','local_command'],
  ]) {
    const result = { ...fail('Authentication error', 10000), status: null,
      error: { code, message: privateMarker, path: privateMarker, spawnargs: [privateMarker] } };
    assert.deepEqual(sanitizedFailureDiagnostic(result), { category, layer, automaticRetry: false, processCode: code });
  }
  assert.deepEqual(sanitizedFailureDiagnostic({ status: null, signal: 'SIGTERM', stderr: privateMarker }),
    { category: 'command_interrupted', layer: 'local_command', automaticRetry: false });
  assert.deepEqual(sanitizedFailureDiagnostic({ status: null, error: { code: privateMarker } }),
    { category: 'bounded_command_failed', layer: 'local_command', automaticRetry: false });
});

test('missing existing credentials are distinct from a reported remote denial and do not prescribe new credentials', () => {
  for (const text of [
    'No credentials found, and the environment is non-interactive so browser login cannot be started.',
    'Your auth token has expired and could not be refreshed, and the environment is non-interactive.',
    "In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable",
  ]) {
    assert.deepEqual(sanitizedFailureDiagnostic(fail(`${text} ${privateMarker}`)),
      { category: 'authentication_required', layer: 'credential_availability', automaticRetry: false });
  }
  for (const result of [fail('Authentication error'), fail(privateMarker, 10000), fail(privateMarker, 9109),
    { status: 1, stderr: `A request to Cloudflare failed. [code: 403]\n${privateMarker}` }]) {
    assert.deepEqual(sanitizedFailureDiagnostic(result), { category: 'remote_auth_denied',
      layer: 'reported_remote_authorization', automaticRetry: false, authorizationCause: 'unknown' });
  }
});

test('configuration and transport errors never become an authorization finding merely because login was mentioned', () => {
  const cases = [
    ['In a non-interactive environment, it is mandatory to specify an account ID.', 'command_configuration_failed','local_configuration'],
    ['More than one account available but unable to select one in non-interactive mode.', 'command_configuration_failed','local_configuration'],
    ['Missing required flag in non-interactive mode: --source', 'command_configuration_failed','local_configuration'],
    ['Your auth token has expired and could not be refreshed because the Cloudflare auth server could not be reached.', 'remote_network_failed','network'],
    ['Could not authenticate: getaddrinfo ENOTFOUND api.cloudflare.com', 'remote_dns_failed','network'],
    ['Could not authenticate: self-signed certificate in certificate chain', 'remote_tls_failed','network'],
    ['The request to Cloudflare API timed out.', 'remote_timeout','network'],
    ['open /private/Forbidden/fixture: EACCES', 'local_access_denied','local_filesystem'],
  ];
  for (const [text, category, layer] of cases) {
    assert.deepEqual(sanitizedFailureDiagnostic(fail(`${text}\n${privateMarker}`)), { category, layer, automaticRetry: false });
  }
});

test('binary stdout is never accessed or decoded even when it resembles an authentication or missing-object response', () => {
  for (const stderr of ['', 'The specified key does not exist.', 'Authentication error']) {
    const result = { status: 1, stderr };
    Object.defineProperty(result, 'stdout', { get() { assert.fail('Object bytes cannot be diagnostic input'); } });
    assert.equal(classifyWranglerFailure(result, { binary: true }), stderr ?
      stderr.startsWith('The specified') ? 'missing' : 'remote_auth_denied' : 'read_failure_unknown');
  }
  assert.equal(classifyWranglerFailure({ status: 1, stdout: Buffer.from('Authentication error; The specified key does not exist.'), stderr: '' }, { binary: true }), 'read_failure_unknown');
  assert.equal(classifyWranglerFailure({ status: 0, stdout: Buffer.from(privateMarker), stderr: '' }, { binary: true }), 'no_failure');
});

test('successful row data, unknown stdout, notes, ANSI noise and unrecognized messages remain non-diagnostic', () => {
  for (const stdout of [privateMarker, JSON.stringify([{ success: false, results: [{ value: 'Authentication error' }] }]),
    JSON.stringify({ error: { notes: [{ text: 'Authentication error' }], secret: privateMarker } }),
    JSON.stringify({ error: { text: `Cannot read /private/Forbidden/${privateMarker}` } })]) {
    const safe = sanitizedFailureDiagnostic({ status: 1, stdout, stderr: '' });
    assert.equal(safe.category, 'read_failure_unknown');
    assert.equal(safe.layer, 'unknown');
    assert.equal(JSON.stringify(safe).includes(privateMarker), false);
  }
  const safe = sanitizedFailureDiagnostic({ status: 1, stdout: '{"error":', stderr: `\u001b[31m${privateMarker}\u001b[0m` });
  assert.equal(safe.category, 'read_failure_unknown');
});


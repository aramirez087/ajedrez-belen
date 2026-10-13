import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { constants, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adjustCharge, applyPaymentCredit, billingPeriod, enrollAthlete, ensureUser,
  getMonthlyPreview, getParentDashboard, getPaymentFile, getReceipt, linkGuardian,
  publishMonth, reviewPayment, revisePayment, submitPayment,
} from '../src/lib/portal/domain.ts';
import { attachSlipDraft, registerSlipDraft } from '../src/lib/portal/ocr.ts';
import { listEmailOutbox, sendOutboxBatch } from '../src/lib/portal/email.ts';
import { renderReceipt } from '../src/lib/portal/receipt.ts';

// Run: node --import tsx scripts/test-portal-restore.mjs
// Only generated, obviously fictional data is accepted. No caller-selected paths,
// environment bindings, existing DBs, WorkOS sessions, R2 access or network calls.
assert.equal(process.argv.length, 2, 'This synthetic drill accepts no paths or arguments');
assert.equal(typeof backup, 'function', 'Use the installed Node runtime with node:sqlite backup support');
let networkCalls = 0;
const forbiddenFetch = async () => { networkCalls++; throw new Error('Network is forbidden in the restore drill'); };
globalThis.fetch = forbiddenFetch;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'output');
if (existsSync(output)) assert.ok(lstatSync(output).isDirectory() && !lstatSync(output).isSymbolicLink(), 'Output must be a regular directory');
else mkdirSync(output, { mode: 0o700 });
const runDirectory = mkdtempSync(join(output, 'restore-drill-'));
chmodSync(runDirectory, 0o700);
const sourceObjects = join(runDirectory, 'source-objects');
const archivedObjects = join(runDirectory, 'backup-objects');
const restoredObjects = join(runDirectory, 'restored-objects');
const sqlRestoredObjects = join(runDirectory, 'sql-restored-objects');
for (const path of [sourceObjects, archivedObjects, restoredObjects, sqlRestoredObjects]) mkdirSync(path, { mode: 0o700 });
const sourcePath = join(runDirectory, 'synthetic-source.sqlite');
const backupPath = join(runDirectory, 'synthetic-backup.sqlite');
const restoredPath = join(runDirectory, 'synthetic-restored.sqlite');
const sqlPath = join(runDirectory, 'synthetic-export.sql');
const sqlRestoredPath = join(runDirectory, 'synthetic-sql-restored.sqlite');
// Use only the already-installed system CLI, with no shell, inherited environment,
// user initialization file or writable source connection. Never install a tool here.
const sqliteCli = '/usr/bin/sqlite3';
const cliOptions = { env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp' }, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 };
const databases = [];
const checks = [];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = value => JSON.parse(JSON.stringify(value));

class SQLiteD1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const database = this;
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async all() { return { results: database.sqlite.prepare(sql).all(...values), success: true, meta: {} }; },
      async first(column) {
        const row = database.sqlite.prepare(sql).get(...values);
        return column ? row?.[column] ?? null : row ?? null;
      },
      async run() { return statement.execute(); },
      execute() {
        const result = database.sqlite.prepare(sql).run(...values);
        return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return statement;
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function openDatabase(path, options = {}) {
  const sqlite = new DatabaseSync(path, options);
  databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys=ON');
  return sqlite;
}
function capture(sqlite) {
  const schema = sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables = {};
  for (const { name } of schema.filter(row => row.type === 'table')) {
    assert.match(name, /^[a-z_]+$/);
    const rows = sqlite.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort();
    tables[name] = { count: rows.length, sha256: sha256(JSON.stringify(rows)) };
  }
  return { schemaSha256: sha256(JSON.stringify(schema)), tables };
}
function healthy(sqlite) {
  assert.equal(sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(normalize(sqlite.prepare('PRAGMA integrity_check').all()), [{ integrity_check: 'ok' }]);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}
function verifySqlExport(path, expected) {
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'SQL export must be a regular file');
  const bytes = readFileSync(path);
  assert.equal(bytes.length, expected.size, 'SQL export size mismatch');
  assert.equal(sha256(bytes), expected.sha256, 'SQL export hash mismatch');
  return bytes.toString('utf8');
}
function importFreshSql(path, sql) {
  // All callers use SQL generated in this run and paths inside its exclusive
  // directory. This is deliberately not an importer for caller-supplied backups.
  writeFileSync(path, '', { flag: 'wx', mode: 0o600 });
  const sqlite = openDatabase(path);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM sqlite_schema').get().n, 0);
  sqlite.exec(sql);
  // SQLite .dump disables foreign keys during table/data creation. Re-enable
  // enforcement and inspect the entire imported graph before using it.
  sqlite.exec('PRAGMA foreign_keys=ON');
  healthy(sqlite);
  return sqlite;
}
function objectPath(base, key) {
  assert.match(key, /^portal\/drafts\/[a-f0-9-]+\/original$/);
  const path = resolve(base, key);
  assert.ok(relative(base, path) && !relative(base, path).startsWith(`..${sep}`));
  return path;
}
function verifyObject(base, object) {
  const path = objectPath(base, object.key);
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'Object must be a regular file');
  const bytes = readFileSync(path);
  assert.equal(bytes.length, object.size, 'Object size mismatch');
  assert.equal(sha256(bytes), object.sha256, 'Object hash mismatch');
}
function captureEvidence(sqlite, base) {
  const inventory = new Map();
  const files = sqlite.prepare('SELECT id AS fileId,payment_id AS paymentId,revision,file_key AS key,file_type AS type,file_size AS size,file_sha256 AS sha256 FROM payment_files ORDER BY file_key').all();
  const fileById = new Map(files.map(file => [file.fileId, file]));
  function entry(reference) {
    const { key, type, size, sha256: hash } = reference;
    const existing = inventory.get(key);
    if (existing) assert.deepEqual({ type: existing.type, size: existing.size, sha256: existing.sha256 },
      { type, size, sha256: hash }, 'Conflicting metadata for one evidence key');
    else inventory.set(key, { key, type, size, sha256: hash, files: [], drafts: [] });
    return inventory.get(key);
  }
  for (const file of files) entry(file).files.push({ fileId: file.fileId, paymentId: file.paymentId, revision: file.revision });
  const drafts = sqlite.prepare('SELECT id AS draftId,state,payment_file_id AS paymentFileId,object_key AS key,file_type AS type,file_size AS size,file_sha256 AS sha256 FROM slip_drafts ORDER BY object_key').all();
  for (const draft of drafts) {
    const referenced = inventory.get(draft.key)?.files.length > 0;
    assert.ok(!referenced || !['deleting', 'deleted'].includes(draft.state), 'Financial evidence cannot be marked for cleanup');
    if (draft.state === 'deleted') continue; // Preserve its DB tombstone without resurrecting bytes.
    if (draft.state === 'attached') {
      const file = fileById.get(draft.paymentFileId);
      assert.ok(file && file.key === draft.key, 'Attached draft must reference its exact financial original');
    }
    entry(draft).drafts.push({ draftId: draft.draftId, state: draft.state, paymentFileId: draft.paymentFileId });
  }
  return [...inventory.values()].sort((a, b) => a.key.localeCompare(b.key)).map(object => {
    const path = objectPath(base, object.key);
    if (!existsSync(path)) {
      assert.equal(object.files.length, 0, 'Missing financial original');
      // Absence does not prove that an upload never occurred. Record the incomplete
      // draft explicitly; never count it as a recovered original or create bytes.
      return { ...object, availability: object.drafts.some(draft => draft.state === 'deleting')
        ? 'missing_cleanup_pending' : 'missing_uncommitted' };
    }
    verifyObject(base, object);
    return { ...object, availability: 'present' };
  });
}
function verifyEvidenceInventory(sqlite, base, expected) {
  // The captured availability is authoritative: losing an archived, previously
  // present draft cannot be reclassified as a harmless interrupted upload.
  assert.deepEqual(captureEvidence(sqlite, base), expected, 'Evidence inventory differs from the captured source');
}
function copyObjects(from, to, manifest) {
  for (const object of manifest) {
    if (object.availability && object.availability !== 'present') {
      assert.equal(existsSync(objectPath(to, object.key)), false, 'Do not invent an unavailable draft original');
      continue;
    }
    verifyObject(from, object);
    const destination = objectPath(to, object.key);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(objectPath(from, object.key), destination, constants.COPYFILE_EXCL);
    chmodSync(destination, 0o600);
    verifyObject(to, object);
  }
}
async function checked(label, action) {
  await action();
  checks.push(label);
  console.log(`PASS ${label}`);
}
function writeJson(name, value) {
  writeFileSync(join(runDirectory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

try {
  const source = openDatabase(sourcePath);
  chmodSync(sourcePath, 0o600);
  source.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  const migrations = ['0001_prototype.sql', '0002_portal.sql', '0003_ocr.sql', '0004_financial_operations.sql'];
  const migrationHashes = {};
  for (const name of migrations) {
    const sql = readFileSync(join(root, 'migrations', name), 'utf8');
    source.exec(sql);
    migrationHashes[name] = sha256(sql);
  }
  const db = new SQLiteD1(source);
  const admin = { id: 'restore-admin', email: 'restore-admin@example.invalid', name: 'PRUEBA RESTORE — administración', isAdmin: true, mode: 'demo' };
  const parent = { id: 'restore-parent', email: 'restore-parent@example.invalid', name: 'PRUEBA RESTORE — responsable', isAdmin: false, mode: 'demo' };
  const unrelated = { id: 'restore-unrelated', email: 'restore-unrelated@example.invalid', name: "PRUEBA RESTORE — O'Connor · familia “B”", isAdmin: false, mode: 'demo' };
  for (const actor of [admin, parent, unrelated]) await ensureUser(db, actor);
  const period = billingPeriod(new Date().toISOString());
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const athleteId = await enrollAthlete(db, admin, { name: 'PRUEBA RESTORE — atleta ficticio A', category: 'Iniciación', feeMinor: 1_200_000, discountMinor: 0, startPeriod: period });
  const otherAthleteId = await enrollAthlete(db, admin, { name: 'PRUEBA RESTORE — atleta ficticio B', category: 'Cadetes', feeMinor: 1_500_000, discountMinor: 0, startPeriod: period });
  await linkGuardian(db, admin, { userId: parent.id, athleteId });
  await linkGuardian(db, admin, { userId: unrelated.id, athleteId: otherAthleteId });
  await publishMonth(db, admin, period, (await getMonthlyPreview(db, period)).snapshot);
  const chargeId = (await getParentDashboard(db, parent)).charges[0].id;
  const adjustment = { operationId: randomUUID(), chargeId, amountMinor: 10_000, reason: 'PRUEBA RESTORE — ajuste sintético de ₡100' };
  await adjustCharge(db, admin, adjustment);
  const fixtureBytes = [
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=', 'base64'),
  ];
  async function syntheticFile(bytes) {
    const file = { key: `portal/drafts/${randomUUID()}/original`, type: 'image/png', size: bytes.length, sha256: sha256(bytes) };
    const draft = await registerSlipDraft(db, parent, file);
    const path = objectPath(sourceObjects, file.key);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    return { file, draftId: draft.id };
  }
  const first = await syntheticFile(fixtureBytes[0]);
  let payment = { submissionId: randomUUID(), payerName: 'PRUEBA RESTORE — persona ficticia', amountMinor: 1_500_000, transferDate: date,
    bankReference: 'RESTORE-SYNTHETIC-0001', allocations: [{ chargeId, amountMinor: 1_000_000 }], file: first.file };
  const originalSubmission = structuredClone(payment);
  const paymentId = await submitPayment(db, parent, payment);
  await attachSlipDraft(db, parent, first.draftId, paymentId);
  const note = 'PRUEBA RESTORE — corregir respaldo ficticio';
  await reviewPayment(db, admin, paymentId, { action: 'needs_info', reason: note, expectedRevision: 1, expectedStatus: 'pending', expectedReviewNote: null });
  const revised = await syntheticFile(fixtureBytes[1]);
  payment = { ...payment, bankReference: 'RESTORE-SYNTHETIC-0001-CORRECTED', file: revised.file };
  await revisePayment(db, parent, paymentId, { ...payment, note: 'PRUEBA RESTORE — corrección ficticia', expectedRevision: 1, expectedStatus: 'needs_info', expectedReviewNote: note });
  await attachSlipDraft(db, parent, revised.draftId, paymentId);
  const verification = data => ({ action: 'verify', bankChecked: true, currency: 'CRC', associationName: 'PRUEBA RESTORE — no es un pago real',
    bankName: 'BANCO FICTICIO — NO TRANSFERIR', receivingAccount: 'RESTORE-SYNTHETIC-ONLY', bankReference: data.bankReference,
    amountMinor: data.amountMinor, paymentDate: data.transferDate, allocations: data.allocations,
    expectedRevision: 1, expectedStatus: 'pending', expectedReviewNote: null });
  const firstVerification = { ...verification(payment), expectedRevision: 2 };
  const receiptId = await reviewPayment(db, admin, paymentId, firstVerification);
  const credit = { operationId: randomUUID(), paymentId, allocations: [{ chargeId, amountMinor: 200_000 }], reason: 'PRUEBA RESTORE — aplicar crédito ficticio' };
  await applyPaymentCredit(db, admin, credit);
  const mailOptions = { fetcher: forbiddenFetch };
  await sendOutboxBatch(db, admin, { EMAIL_MODE: 'dry_run' }, mailOptions);
  const second = await syntheticFile(fixtureBytes[0]);
  const voidPayment = { ...payment, submissionId: randomUUID(), bankReference: 'RESTORE-SYNTHETIC-0002', amountMinor: 10_000, allocations: [{ chargeId, amountMinor: 10_000 }], file: second.file };
  const voidPaymentId = await submitPayment(db, parent, voidPayment);
  await attachSlipDraft(db, parent, second.draftId, voidPaymentId);
  const voidReceiptId = await reviewPayment(db, admin, voidPaymentId, verification(voidPayment));
  await sendOutboxBatch(db, admin, { EMAIL_MODE: 'dry_run' }, mailOptions);
  await reviewPayment(db, admin, voidPaymentId, { action: 'void', reason: 'PRUEBA RESTORE — anulación ficticia', expectedRevision: 1, expectedStatus: 'verified', expectedReviewNote: null });
  await sendOutboxBatch(db, admin, { EMAIL_MODE: 'dry_run' }, mailOptions);
  const unsubmitted = await syntheticFile(fixtureBytes[1]);
  const missingOriginal = { ...unsubmitted.file, key: `portal/drafts/${randomUUID()}/original` };
  const missingDraft = await registerSlipDraft(db, parent, missingOriginal); // Reservation before an interrupted object write.

  await checked('synthetic fixture contains corrected evidence, issued/void receipts, ledger operations and simulated outbox', async () => {
    healthy(source);
    assert.equal(source.prepare('SELECT count(*) n FROM payment_files').get().n, 3);
    assert.equal(source.prepare('SELECT count(*) n FROM payment_revisions').get().n, 3);
    assert.equal(source.prepare("SELECT count(*) n FROM slip_drafts WHERE state='attached'").get().n, 3);
    assert.equal(source.prepare('SELECT count(*) n FROM financial_operations').get().n, 2);
    assert.deepEqual(source.prepare('SELECT status FROM receipts ORDER BY sequence').all().map(row => row.status), ['issued', 'void']);
    assert.deepEqual(source.prepare('SELECT status FROM payments ORDER BY bank_reference').all().map(row => row.status), ['verified', 'void']);
    const mail = await listEmailOutbox(db, admin);
    assert.equal(mail.length, 3);
    assert.ok(mail.every(row => ['dry_run', 'cancelled'].includes(row.status)));
    assert.equal(source.prepare('SELECT count(*) n FROM portal_email_daily_budget').get().n, 0);
    assert.equal(networkCalls, 0);
  });
  const before = capture(source);
  const beforeDashboard = await getParentDashboard(db, parent);
  const beforeReceipt = await getReceipt(db, parent, receiptId);
  const beforeVoidReceipt = await getReceipt(db, parent, voidReceiptId);
  const beforeRender = renderReceipt(beforeReceipt.snapshot);
  const fileManifest = source.prepare('SELECT id AS fileId,payment_id AS paymentId,revision,file_key AS key,file_type AS type,file_size AS size,file_sha256 AS sha256 FROM payment_files ORDER BY file_key').all();
  const objectInventory = captureEvidence(source, sourceObjects);
  await checked('evidence inventory includes unattached originals and explicitly records unavailable unsubmitted drafts', async () => {
    assert.equal(objectInventory.length, 5);
    assert.equal(objectInventory.filter(object => object.availability === 'present').length, 4);
    assert.equal(objectInventory.filter(object => object.files.length).length, 3);
    const waiting = objectInventory.find(object => object.key === unsubmitted.file.key);
    assert.equal(waiting.availability, 'present');
    assert.equal(waiting.files.length, 0);
    assert.equal(waiting.drafts[0].draftId, unsubmitted.draftId);
    const unavailable = objectInventory.find(object => object.key === missingOriginal.key);
    assert.equal(unavailable.availability, 'missing_uncommitted');
    assert.equal(unavailable.files.length, 0);
    assert.equal(unavailable.drafts[0].draftId, missingDraft.id);
    for (const object of objectInventory.filter(object => object.availability === 'present')) {
      chmodSync(objectPath(sourceObjects, object.key), 0o400);
    }
  });
  // No writers remain during this drill's DB and file snapshot. Online D1/R2
  // consistency requires a separate coordinated capture/restore procedure.
  source.exec('PRAGMA query_only=ON');
  assert.ok(statSync(`${sourcePath}-wal`).size > 0, 'Committed WAL must exist so a raw main-file copy would be insufficient');
  let copiedPages;
  await checked('SQLite backup captures committed WAL into a new backup and a separately restored database', async () => {
    assert.equal(existsSync(backupPath), false);
    copiedPages = await backup(source, backupPath);
    chmodSync(backupPath, 0o600);
    assert.ok(copiedPages > 0);
    const archive = openDatabase(backupPath, { readOnly: true });
    healthy(archive);
    assert.deepEqual(capture(archive), before);
    assert.equal(existsSync(restoredPath), false);
    await backup(archive, restoredPath);
    chmodSync(restoredPath, 0o600);
  });
  let sqlExport;
  let sqlRestored;
  await checked('installed SQLite CLI exports the synthetic snapshot as SQL and imports a fresh database without migrations', async () => {
    const version = spawnSync(sqliteCli, ['-version'], cliOptions);
    assert.ifError(version.error);
    assert.equal(version.status, 0, 'Installed SQLite version check failed');
    const dump = spawnSync(sqliteCli, ['-batch', '-bail', '-readonly', '-init', '/dev/null', backupPath, '.dump'], cliOptions);
    assert.ifError(dump.error);
    assert.equal(dump.status, 0, 'Synthetic SQLite SQL export failed');
    assert.equal(dump.stderr.trim(), '', 'Synthetic SQL export emitted diagnostics');
    assert.match(dump.stdout, /BEGIN TRANSACTION;/);
    assert.match(dump.stdout.trimEnd(), /COMMIT;$/);
    writeFileSync(sqlPath, dump.stdout, { flag: 'wx', mode: 0o600 });
    sqlExport = { file: 'synthetic-export.sql', size: Buffer.byteLength(dump.stdout), sha256: sha256(dump.stdout),
      exporter: sqliteCli, exporterVersion: version.stdout.trim(), format: 'SQLite CLI .dump; not a D1 export' };
    sqlRestored = importFreshSql(sqlRestoredPath, verifySqlExport(sqlPath, sqlExport));
    assert.deepEqual(capture(sqlRestored), before);
    assert.equal(sqlRestored.prepare('SELECT name FROM users WHERE id=?').get(unrelated.id).name, unrelated.name,
      'SQL serialization must preserve apostrophes and Unicode');
    assert.deepEqual(capture(source), before);
  });
  await checked('SQL manifest rejects a missing export and same-length corrupted bytes before import', async () => {
    assert.throws(() => verifySqlExport(join(runDirectory, 'missing-export.sql'), sqlExport), /ENOENT/);
    const corrupted = Buffer.from(readFileSync(sqlPath));
    corrupted[0] ^= 1;
    const path = join(runDirectory, 'corrupt-export.sql');
    writeFileSync(path, corrupted, { flag: 'wx', mode: 0o600 });
    assert.throws(() => verifySqlExport(path, sqlExport), /SQL export hash mismatch/);
  });
  await checked('SQL recovery validation detects valid SQL with a missing trigger or changed row despite passing integrity checks', async () => {
    const trigger = source.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name LIMIT 1").get().name;
    assert.match(trigger, /^[a-z_]+$/);
    const negatives = [
      ['missing-trigger', `DROP TRIGGER "${trigger}";`],
      ['changed-row', "UPDATE users SET name='PRUEBA RESTORE — altered export' WHERE id='restore-unrelated';"],
    ];
    for (const [label, mutation] of negatives) {
      const negative = importFreshSql(join(runDirectory, `invalid-${label}.sqlite`), `${verifySqlExport(sqlPath, sqlExport)}\n${mutation}`);
      assert.throws(() => assert.deepEqual(capture(negative), before), { code: 'ERR_ASSERTION' });
    }
  });
  await checked('inventory rejects missing financial originals despite interrupted attachment and rejects conflicting database metadata', async () => {
    const interrupted = importFreshSql(join(runDirectory, 'invalid-interrupted-attachment.sqlite'), verifySqlExport(sqlPath, sqlExport));
    interrupted.prepare("UPDATE slip_drafts SET state='draft',payment_file_id=NULL WHERE id=?").run(first.draftId);
    healthy(interrupted);
    const missingFinancial = join(runDirectory, 'missing-financial-original');
    mkdirSync(missingFinancial, { mode: 0o700 });
    copyObjects(sourceObjects, missingFinancial, objectInventory.filter(object => object.key !== first.file.key));
    assert.throws(() => captureEvidence(interrupted, missingFinancial), /Missing financial original/);

    const conflicting = importFreshSql(join(runDirectory, 'invalid-draft-metadata.sqlite'), verifySqlExport(sqlPath, sqlExport));
    conflicting.exec('DROP TRIGGER immutable_draft_evidence');
    conflicting.prepare('UPDATE slip_drafts SET file_size=file_size+1 WHERE id=?').run(first.draftId);
    healthy(conflicting);
    assert.throws(() => captureEvidence(conflicting, sourceObjects), /Conflicting metadata for one evidence key/);
    assert.deepEqual(capture(source), before);
  });
  copyObjects(sourceObjects, archivedObjects, objectInventory);
  verifyEvidenceInventory(source, archivedObjects, objectInventory);
  const restorations = [
    { name: 'binary', sqlite: openDatabase(restoredPath), objects: restoredObjects },
    { name: 'SQL', sqlite: sqlRestored, objects: sqlRestoredObjects },
  ];
  const immutableCases = [
    ["UPDATE receipts SET snapshot_json='{}' WHERE id=?", receiptId, /immutable_receipt/],
    ['DELETE FROM receipts WHERE id=?', receiptId, /immutable_receipt/],
    ["UPDATE audit_events SET action='tampered' WHERE actor_id=?", admin.id, /immutable_audit/],
    ['DELETE FROM audit_events WHERE actor_id=?', admin.id, /immutable_audit/],
    ['UPDATE payment_allocations SET amount_minor=1 WHERE payment_id=?', paymentId, /immutable_allocations/],
    ['DELETE FROM payment_allocations WHERE payment_id=?', paymentId, /immutable_allocations/],
    ["UPDATE financial_operations SET payload_json='{}' WHERE operation_id=?", credit.operationId, /immutable_financial_operation/],
    ['DELETE FROM financial_operations WHERE operation_id=?', credit.operationId, /immutable_financial_operation/],
    ["UPDATE payment_revisions SET note='tampered' WHERE payment_id=?", paymentId, /immutable_revision/],
    ["UPDATE payment_files SET file_sha256='tampered' WHERE payment_id=?", paymentId, /immutable_file/],
    ['UPDATE payments SET verified_amount_minor=1 WHERE id=?', paymentId, /immutable_verified_payment/],
    ["UPDATE email_outbox SET recipient_email='other@example.invalid' WHERE receipt_id=?", receiptId, /immutable_email_recipient/],
  ];
  for (const restoration of restorations) {
    const restored = restoration.sqlite;
    const restoredDb = new SQLiteD1(restored);
    const restoredObjects = restoration.objects;
    const restoredCheck = (label, action) => checked(`${restoration.name}: ${label}`, action);
    await restoredCheck('restored schema, every table digest, counts, integrity and foreign keys match the snapshot', async () => {
      healthy(restored);
      assert.deepEqual(capture(restored), before);
      assert.deepEqual(await getParentDashboard(restoredDb, parent), beforeDashboard);
      assert.deepEqual(await getReceipt(restoredDb, parent, receiptId), beforeReceipt);
      assert.deepEqual(await getReceipt(restoredDb, parent, voidReceiptId), beforeVoidReceipt);
      assert.deepEqual(renderReceipt((await getReceipt(restoredDb, parent, receiptId)).snapshot), beforeRender);
    });
    await restoredCheck('private evidence recovery preserves original keys, revisions, MIME, byte counts and SHA-256 hashes', async () => {
      copyObjects(archivedObjects, restoredObjects, objectInventory);
      const restoredFiles = restored.prepare('SELECT id AS fileId,payment_id AS paymentId,revision,file_key AS key,file_type AS type,file_size AS size,file_sha256 AS sha256 FROM payment_files ORDER BY file_key').all();
      assert.deepEqual(restoredFiles, fileManifest);
      for (const file of restoredFiles) verifyObject(restoredObjects, file);
      assert.equal(new Set(restoredFiles.map(file => file.key)).size, 3);
      verifyEvidenceInventory(restored, restoredObjects, objectInventory);
    });
    await restoredCheck('restored inventory rejects omitted, missing, corrupt or mislabelled unattached originals', async () => {
      const waiting = objectInventory.find(object => object.key === unsubmitted.file.key);
      assert.throws(() => verifyEvidenceInventory(restored, restoredObjects, objectInventory.filter(object => object.key !== waiting.key)), /Evidence inventory differs/);
      const wrongMime = objectInventory.map(object => object.key === waiting.key ? { ...object, type: 'application/pdf' } : object);
      assert.throws(() => verifyEvidenceInventory(restored, restoredObjects, wrongMime), /Evidence inventory differs/);
      const negative = join(runDirectory, `${restoration.name.toLowerCase()}-draft-negative-controls`);
      mkdirSync(negative, { mode: 0o700 });
      copyObjects(archivedObjects, negative, fileManifest);
      assert.throws(() => verifyEvidenceInventory(restored, negative, objectInventory), /Evidence inventory differs/);
      const path = objectPath(negative, waiting.key);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const corrupted = Buffer.from(readFileSync(objectPath(archivedObjects, waiting.key)));
      corrupted[0] ^= 1;
      writeFileSync(path, corrupted, { flag: 'wx', mode: 0o600 });
      assert.throws(() => verifyEvidenceInventory(restored, negative, objectInventory), /Object hash mismatch/);
      verifyEvidenceInventory(restored, restoredObjects, objectInventory);
    });
    await restoredCheck('the file manifest detects missing objects and same-length corrupted content', async () => {
      const negative = join(runDirectory, `${restoration.name.toLowerCase()}-negative-controls`);
      mkdirSync(negative, { mode: 0o700 });
      assert.throws(() => verifyObject(negative, fileManifest[0]), /ENOENT/);
      const path = objectPath(negative, fileManifest[0].key);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const corrupted = Buffer.from(readFileSync(objectPath(archivedObjects, fileManifest[0].key)));
      corrupted[0] ^= 1;
      writeFileSync(path, corrupted, { flag: 'wx', mode: 0o600 });
      assert.throws(() => verifyObject(negative, fileManifest[0]), /Object hash mismatch/);
    });
    await restoredCheck('restored family access still denies another family the receipt and private evidence', async () => {
      await assert.rejects(getReceipt(restoredDb, unrelated, receiptId), error => error.status === 404);
      for (const file of fileManifest) {
        assert.equal((await getPaymentFile(restoredDb, parent, file.fileId)).sha256, file.sha256);
        await assert.rejects(getPaymentFile(restoredDb, unrelated, file.fileId), error => error.status === 404);
      }
      assert.equal((await getParentDashboard(restoredDb, unrelated)).payments.length, 0);
    });
    await restoredCheck('restored triggers reject twelve receipt, ledger, audit, evidence and recipient mutations', async () => {
      for (const [sql, value, error] of immutableCases) assert.throws(() => restored.prepare(sql).run(value), error);
      assert.deepEqual(capture(restored), before);
    });
    await restoredCheck('restored idempotency markers prevent delayed credit/adjustment replay and changed-payload reuse', async () => {
      await applyPaymentCredit(restoredDb, admin, credit);
      await adjustCharge(restoredDb, admin, adjustment);
      await assert.rejects(applyPaymentCredit(restoredDb, admin, { ...credit, reason: 'changed payload' }), error => error.status === 409);
      await assert.rejects(adjustCharge(restoredDb, admin, { ...adjustment, amountMinor: adjustment.amountMinor + 1 }), error => error.status === 409);
      await assert.rejects(reviewPayment(restoredDb, admin, paymentId, firstVerification), error => error.status === 409);
      assert.deepEqual(capture(restored), before);
    });
    await restoredCheck('lost submission responses replay after correction, verification and void without duplicate records or changed ownership', async () => {
      assert.equal(await submitPayment(restoredDb, parent, originalSubmission), paymentId);
      assert.equal(await submitPayment(restoredDb, parent, voidPayment), voidPaymentId);
      for (const original of [originalSubmission, voidPayment]) {
        await assert.rejects(submitPayment(restoredDb, parent, { ...original, bankReference: 'RESTORE-CHANGED-REPLAY' }), error => error.status === 409 && error.code === 'conflict');
        await assert.rejects(submitPayment(restoredDb, unrelated, original), error => error.status === 409 && error.code === 'conflict');
      }
      assert.deepEqual(capture(restored), before);
      verifyEvidenceInventory(restored, restoredObjects, objectInventory);
    });
    await restoredCheck('a failed restored transaction rolls back preceding writes and keeps foreign keys intact', async () => {
      await assert.rejects(restoredDb.batch([
        restoredDb.prepare('INSERT INTO users(id,email,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind('restore-rollback-only', 'rollback@example.invalid', 'PRUEBA — rollback', date, date),
        restoredDb.prepare('INSERT INTO guardian_links(user_id,athlete_id,active,receipt_opt_in,linked_by,created_at,updated_at) VALUES(?,?,1,0,?,?,?)').bind('restore-rollback-only', 'missing-athlete', admin.id, date, date),
      ]), /FOREIGN KEY constraint failed/);
      assert.equal(restored.prepare("SELECT count(*) n FROM users WHERE id='restore-rollback-only'").get().n, 0);
      healthy(restored);
      assert.deepEqual(capture(restored), before);
    });
    await restoredCheck('restoring simulated mail history never resends it and leaves original source unchanged', async () => {
      const mail = await sendOutboxBatch(restoredDb, admin, { EMAIL_MODE: 'dry_run' }, mailOptions);
      assert.equal(mail.processed, 0);
      assert.equal(mail.dailyAttempts, 0);
      assert.equal(networkCalls, 0);
      assert.deepEqual(capture(restored), before);
      assert.deepEqual(capture(source), before);
      for (const file of fileManifest) { verifyObject(sourceObjects, file); verifyObject(restoredObjects, file); }
      verifyEvidenceInventory(source, sourceObjects, objectInventory);
    });
  }
  const manifest = {
    version: 3, syntheticOnly: true, createdAt: new Date().toISOString(), consistency: 'Quiesced single-process SQLite and synthetic file store',
    migrations: migrationHashes, database: { file: 'synthetic-backup.sqlite', sha256: sha256(readFileSync(backupPath)), copiedPages, ...before },
    sqlExport,
    objects: objectInventory,
    limitations: ['SQL round trip uses installed SQLite .dump, not the D1 export format or remote migration-tracking table.', 'No remote D1 export/import, Time Travel or cloud permissions exercised.', 'No R2 API, metadata/ACL restoration or online DB/R2 snapshot coordination exercised.', 'No real credentials, accounts, records or email were used.'],
  };
  writeJson('recovery-manifest.json', manifest);
  const report = {
    status: 'passed', syntheticOnly: true, checks: checks.length, checkNames: checks, networkCalls,
    tables: Object.keys(before.tables).length, rowCounts: Object.fromEntries(Object.entries(before.tables).map(([name, value]) => [name, value.count])),
    privateObjects: objectInventory.filter(object => object.availability === 'present').length,
    financialEvidenceObjects: fileManifest.length,
    unavailableDraftObjects: objectInventory.filter(object => object.availability !== 'present').length,
    recoveryFormats: ['binary SQLite backup', 'SQLite SQL dump'],
    immutableMutationsRejected: immutableCases.length * restorations.length, immutableMutationsRejectedPerFormat: immutableCases.length,
    sqlExport,
    outputDirectory: relative(root, runDirectory), limitations: manifest.limitations,
  };
  writeJson('report.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const database of databases.reverse()) database.close();
  // Retain only this run's synthetic artifacts for inspection; never delete other output.
}

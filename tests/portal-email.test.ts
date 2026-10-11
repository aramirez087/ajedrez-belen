import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { listEmailOutbox, prepareReceiptEmail, retryEmailOutbox, sendOutboxBatch, sendOutboxReceipt } from '../src/lib/portal/email.ts';
import { portalMutation } from '../src/lib/portal/routes.ts';
import { formText, successRedirect } from '../src/lib/portal/http.ts';
import type { Actor, ReceiptSnapshot } from '../src/lib/portal/types.ts';

const now = new Date('2026-10-10T15:00:00.000Z');
const actor: Actor = { id: 'admin-1', email: 'admin@example.invalid', name: 'Admin', isAdmin: true, mode: 'workos' };
const live = { EMAIL_MODE: 'live', BREVO_API_KEY: 'synthetic-fixture-key', EMAIL_FROM: 'association@example.invalid', EMAIL_FROM_NAME: 'Asociación' };
const receipt: ReceiptSnapshot = { version: 1, receiptNumber: 'AB-2026-000001', associationName: 'Asociación de prueba',
  payerName: 'Persona de prueba', paymentDate: '2026-10-08', issuedAt: '2026-10-10T14:00:00.000Z', currency: 'CRC',
  amountMinor: 1_200_000, bankReference: '202610010283002453950810', bankName: 'BAC', receivingAccount: 'Cuenta de prueba',
  lines: [{ athleteId: 'athlete-1', athleteName: 'Atleta de prueba', chargeId: 'charge-1', period: '2026-10', amountMinor: 1_200_000 }],
  unallocatedMinor: 0, designatedAdult: { id: 'adult-1', name: 'Responsable', email: 'parent@example.invalid' }, demo: false };
const id = 'e4495607-4318-4b41-a215-cba98e9c97bb';
const message = { recipientEmail: 'parent@example.invalid', recipientName: 'Responsable', idempotencyKey: id, snapshot: receipt };

// Real SQLite executes the production claim/budget SQL, including transaction rollback.
function database(options: { staffAssisted?: boolean; verified?: boolean; snapshotAdultId?: string } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0002_portal.sql', import.meta.url), 'utf8'));
  class Statement {
    values: Array<string | number | null> = [];
    constructor(readonly sql: string) {}
    bind(...values: Array<string | number | null>) { const statement = new Statement(this.sql); statement.values = values; return statement; }
    run() { const result = sqlite.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) }, results: [] }; }
    async first<T>() { return sqlite.prepare(this.sql).get(...this.values) as T ?? null; }
    async all<T>() { return { success: true, meta: {}, results: sqlite.prepare(this.sql).all(...this.values) as T[] }; }
  }
  const db = { prepare: (sql: string) => new Statement(sql), batch: async (statements: Statement[]) => {
    sqlite.exec('BEGIN');
    try { const results = statements.map((statement) => statement.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } as unknown as D1Database;
  const insert = (sql: string, ...values: Array<string | number | null>) => sqlite.prepare(sql).run(...values);
  insert('INSERT INTO users VALUES(?,?,?,?,?,?)', actor.id, actor.email, actor.name, 1, now.toISOString(), now.toISOString());
  insert('INSERT INTO users VALUES(?,?,?,?,?,?)', 'adult-1', message.recipientEmail, message.recipientName, 1, now.toISOString(), now.toISOString());
  insert('INSERT INTO users VALUES(?,?,?,?,?,?)', 'adult-2', 'other@example.invalid', 'Otro responsable', 1, now.toISOString(), now.toISOString());
  insert('INSERT INTO athletes VALUES(?,?,?,?,?,?,?,?,?,?)', 'athlete-1', 'Atleta de prueba', 'Formación', 1_200_000, 0, null, 1, '2026-10', now.toISOString(), now.toISOString());
  insert('INSERT INTO guardian_links VALUES(?,?,?,?,?,?,?)', 'adult-1', 'athlete-1', 1, 0, actor.id, now.toISOString(), now.toISOString());
  insert('INSERT INTO guardian_links VALUES(?,?,?,?,?,?,?)', 'adult-2', 'athlete-1', 1, 1, actor.id, now.toISOString(), now.toISOString());
  insert(`INSERT INTO payments(id,designated_user_id,submitted_by,payer_name,amount_minor,transfer_date,bank_reference,status,submitted_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, 'payment-1', 'adult-1', options.staffAssisted ? actor.id : 'adult-1', 'Persona', 1_200_000, '2026-10-08', 'TEST-1', 'pending', now.toISOString(), now.toISOString());
  const verify = (paymentId = 'payment-1') => insert(`UPDATE payments SET status='verified',verified_amount_minor=1200000,
    verified_reference=?,verified_date='2026-10-08',verified_bank_name='BAC',verified_receiving_account='Cuenta de prueba',
    verified_by=?,verified_at=?,bank_match_key=? WHERE id=?`, paymentId, actor.id, now.toISOString(), paymentId, paymentId);
  if (options.verified !== false) verify();
  insert('INSERT INTO receipts(id,payment_id,number,year,sequence,snapshot_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)', 'receipt-1', 'payment-1', receipt.receiptNumber, 2026, 1, JSON.stringify({...receipt,designatedAdult:{...receipt.designatedAdult,id:options.snapshotAdultId ?? receipt.designatedAdult.id}}), 'issued', now.toISOString());
  const enqueue = (outboxId = id, recipientId = 'adult-1', email = message.recipientEmail, kind = 'receipt') => {
    insert(`INSERT INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'queued',0,?,?,?)`, outboxId, 'receipt-1', recipientId, email, 'Responsable', kind, now.toISOString(), now.toISOString(), now.toISOString());
  };
  enqueue();
  return { db, sqlite, enqueue, verify };
}

test('dry run makes no provider request and snapshots an exact durable outbox result', async () => {
  const { db, sqlite } = database();
  try {
    const result = await sendOutboxBatch(db, { ...actor, mode: 'demo' }, {}, { now, fetcher: async () => { throw new Error('Must not fetch'); } });
    assert.equal(result.results[0]?.status, 'dry_run');
    assert.equal(result.dailyAttempts, 0);
    assert.equal((await listEmailOutbox(db, actor))[0]?.status, 'dry_run');
    assert.equal(await retryEmailOutbox(db, actor, id, now), false);
    assert.equal(await retryEmailOutbox(db, actor, id, new Date(now.getTime() + 60_000)), true);
  } finally { sqlite.close(); }
});

test('a live send uses one HTTPS request with stored address and the persisted UUID', async () => {
  let calls = 0;
  const output = await sendOutboxReceipt(live, message, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.to, [{ email: message.recipientEmail, name: message.recipientName }]);
    assert.equal(body.headers.idempotencyKey, id);
    assert.ok(body.textContent.includes(receipt.bankReference));
    assert.ok(!String(init?.body).includes('slip') && !String(init?.body).includes('api-key'));
    return Response.json({ messageId: '<fixture@brevo>' }, { status: 201 });
  }, now);
  assert.deepEqual(output, { status: 'accepted', providerMessageId: '<fixture@brevo>' });
  assert.equal(calls, 1);
});

test('live batch requires real administrator identity, and demo snapshots cannot leave the lab', async () => {
  const { db, sqlite } = database();
  try {
    await assert.rejects(sendOutboxBatch(db, { ...actor, mode: 'demo' }, live, { now }), { status: 403 });
    await assert.rejects(listEmailOutbox(db, { ...actor, isAdmin: false }), { status: 403 });
    const output = await sendOutboxReceipt(live, { ...message, snapshot: { ...receipt, demo: true } }, async () => { throw new Error('Must not fetch'); });
    assert.equal(output.status, 'blocked');
    if ('code' in output) assert.equal(output.code, 'demo_receipt');
  } finally { sqlite.close(); }
});

test('a durable claim and budget reservation prevent duplicate and over-cap sends', async () => {
  const { db, sqlite } = database();
  try {
    sqlite.prepare('INSERT INTO portal_email_daily_budget VALUES(?,?)').run('2026-10-10', 249);
    let calls = 0;
    const fetcher = async () => { calls++; return Response.json({ messageId: '<once@brevo>' }, { status: 201 }); };
    const [first, second] = await Promise.all([
      sendOutboxBatch(db, actor, live, { now, fetcher }), sendOutboxBatch(db, actor, live, { now, fetcher }),
    ]);
    assert.equal(first.dailyAttempts, 250);
    assert.equal(second.processed, 0);
    assert.equal(calls, 1);
    assert.equal(await retryEmailOutbox(db, actor, id, new Date(now.getTime() + 86_400_000)), false);
    sqlite.prepare("UPDATE email_outbox SET status='queued'").run();
    const capped = await sendOutboxBatch(db, actor, live, { now, fetcher });
    assert.equal(capped.processed, 0);
    assert.equal(capped.remaining, 1);
    assert.equal(calls, 1);
  } finally { sqlite.close(); }
});

test('revoked links, changed addresses, inactive uploaders and legacy guardian copies cancel queued mail', async () => {
  for (const staffAssisted of [false,true]) for (const revoke of ['link', 'email', 'inactive', 'legacy_copy']) {
    const { db, sqlite, enqueue } = database({staffAssisted});
    try {
      if (revoke === 'link') sqlite.prepare('UPDATE guardian_links SET active=0 WHERE user_id=?').run('adult-1');
      if (revoke === 'email') sqlite.prepare('UPDATE users SET email=? WHERE id=?').run('changed@example.invalid', 'adult-1');
      if (revoke === 'inactive') sqlite.prepare('UPDATE users SET active=0 WHERE id=?').run('adult-1');
      if (revoke === 'legacy_copy') {
        sqlite.prepare('DELETE FROM email_outbox').run();
        enqueue(id, 'adult-2', 'other@example.invalid');
        // Even an opted-in guardian is not the uploader and must not receive a copy.
      }
      const result = await sendOutboxBatch(db, actor, live, { now, fetcher: async () => { throw new Error('Must not fetch'); } });
      assert.equal(result.results[0]?.status, 'cancelled');
      assert.equal(result.dailyAttempts, 0);
    } finally { sqlite.close(); }
  }
});

test('429 refusal persists a backoff, then only an explicit action requeues the same UUID', async () => {
  const { db, sqlite } = database();
  try {
    const result = await sendOutboxBatch(db, actor, live, { now, fetcher: async () => Response.json({ code: 'rate_limit' }, { status: 429, headers: { 'retry-after': '7200' } }) });
    assert.equal(result.results[0]?.status, 'rejected');
    assert.equal(await retryEmailOutbox(db, actor, id, new Date(now.getTime() + 7_199_000)), false);
    assert.equal(await retryEmailOutbox(db, actor, id, new Date(now.getTime() + 7_200_000)), true);
    const rows = await listEmailOutbox(db, actor);
    assert.equal(rows[0]?.id, id);
    assert.equal(rows[0]?.status, 'queued');
  } finally { sqlite.close(); }
});

test('timeouts, 5xx, malformed success and duplicate keys stay unknown without retry', async () => {
  const responses = [ async () => { throw new Error('Synthetic disconnect'); },
    async () => Response.json({ messageId: '<possible@brevo>' }, { status: 503 }),
    async () => Response.json({}, { status: 201 }),
    async () => Response.json({ code: 'duplicate_parameter' }, { status: 400 }),
    async () => new Response('x'.repeat(20_000), { status: 201 }) ];
  for (const fetcher of responses) {
    const { db, sqlite } = database();
    try {
      const result = await sendOutboxBatch(db, actor, live, { now, fetcher });
      assert.equal(result.results[0]?.status, 'unknown');
      assert.equal(await retryEmailOutbox(db, actor, id, new Date(now.getTime() + 86_400_000)), false);
    } finally { sqlite.close(); }
  }
});

test('an interrupted sending claim becomes unknown and never gets automatically requeued', async () => {
  const { db, sqlite } = database();
  try {
    sqlite.prepare("UPDATE email_outbox SET status='sending',claimed_at=?,claim_token=?").run('2026-10-10T14:50:00.000Z', 'claim');
    const result = await sendOutboxBatch(db, actor, live, { now, fetcher: async () => { throw new Error('Must not fetch'); } });
    assert.equal(result.processed, 0);
    assert.equal((await listEmailOutbox(db, actor))[0]?.status, 'unknown');
  } finally { sqlite.close(); }
});

test('a timeout aborts the single request instead of making another provider attempt', async () => {
  let calls = 0;
  const result = await sendOutboxReceipt({ ...live, EMAIL_TIMEOUT_MS: 10 }, message, async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'unknown');
});

test('an issuance-scoped batch leaves other receipts in the durable backlog', async () => {
  const { db, sqlite, verify } = database();
  try {
    sqlite.prepare(`INSERT INTO payments(id,designated_user_id,submitted_by,payer_name,amount_minor,transfer_date,bank_reference,status,submitted_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('payment-2', 'adult-1', 'adult-1', 'Persona', 1_200_000, '2026-10-08', 'TEST-2', 'pending', now.toISOString(), now.toISOString());
    verify('payment-2');
    sqlite.prepare('INSERT INTO receipts(id,payment_id,number,year,sequence,snapshot_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('receipt-2', 'payment-2', 'AB-2026-000002', 2026, 2, JSON.stringify({ ...receipt, receiptNumber: 'AB-2026-000002' }), 'issued', now.toISOString());
    sqlite.prepare(`INSERT INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,attempts,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'queued',0,?,?,?)`).run('6e4765bd-5964-409a-8f6e-3929ea7118a3', 'receipt-2', 'adult-1', message.recipientEmail,
        message.recipientName, 'receipt', now.toISOString(), now.toISOString(), now.toISOString());
    const result = await sendOutboxBatch(db, actor, {}, { now, receiptId: 'receipt-1' });
    assert.equal(result.processed, 1);
    assert.equal(result.remaining, 0);
    assert.equal(sqlite.prepare('SELECT status FROM email_outbox WHERE receipt_id=?').get('receipt-2')?.status, 'queued');
  } finally { sqlite.close(); }
});

test('a void notification sends the immutable receipt with a visible annulment notice', async () => {
  const { db, sqlite, enqueue } = database();
  try {
    sqlite.prepare("UPDATE payments SET status='void' WHERE id=?").run('payment-1');
    sqlite.prepare("UPDATE receipts SET status='void',void_reason=?,voided_at=? WHERE id=?")
      .run('Pago duplicado', now.toISOString(), 'receipt-1');
    const voidId = 'ef67eebc-b396-45b9-bf34-ffda60d59e92';
    enqueue(voidId, 'adult-1', message.recipientEmail, 'receipt_void');
    let calls = 0;
    const result = await sendOutboxBatch(db, actor, live, { now, receiptId: 'receipt-1', fetcher: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.match(body.subject, /^\[ANULADO\]/);
      assert.equal(body.headers.idempotencyKey, voidId);
      assert.ok(body.textContent.includes('Pago duplicado') && body.htmlContent.includes('ANULADO'));
      return Response.json({ messageId: '<void@brevo>' }, { status: 201 });
    } });
    assert.equal(calls, 1);
    assert.equal(result.results.find((item) => item.id === id)?.status, 'cancelled');
    assert.equal(result.results.find((item) => item.id === voidId)?.status, 'accepted');
  } finally { sqlite.close(); }
});

test('the capped outbox view prioritizes old unresolved rows over recent completed history', async () => {
  const { db, sqlite } = database();
  try {
    sqlite.prepare("UPDATE email_outbox SET status='rejected',last_error_code='provider_limit' WHERE id=?").run(id);
    const insert = (index: number, status: string, createdAt: string) => {
      const userId = `list-adult-${index}`;
      const outboxId = crypto.randomUUID();
      sqlite.prepare('INSERT INTO users(id,email,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)')
        .run(userId, `${userId}@example.invalid`, 'Responsable de prueba', createdAt, createdAt);
      sqlite.prepare(`INSERT INTO email_outbox(id,receipt_id,recipient_id,recipient_email,recipient_name,kind,status,attempts,next_attempt_at,created_at,updated_at)
        VALUES(?,?,?,?,?,'receipt',?,0,?,?,?)`).run(outboxId, 'receipt-1', userId, `${userId}@example.invalid`,
          'Responsable de prueba', status, createdAt, createdAt, createdAt);
      return outboxId;
    };
    const oldestId = insert(1, 'queued', '2026-10-10T14:00:00.000Z');
    const ambiguousId = insert(2, 'unknown', '2026-10-10T16:00:00.000Z');
    let newestCompletedId;
    for (let index = 3; index < 103; index++) {
      newestCompletedId = insert(index, index % 2 ? 'accepted' : 'dry_run', new Date(now.getTime() + 86_400_000 + index * 1000).toISOString());
    }
    const rows = await listEmailOutbox(db, actor);
    assert.equal(rows.length, 100);
    assert.deepEqual(rows.slice(0, 3).map((row) => row.id), [oldestId, id, ambiguousId]);
    assert.equal(rows[3]?.id, newestCompletedId);
    assert.equal((await listEmailOutbox(db, actor, 1))[0]?.id, oldestId);
  } finally { sqlite.close(); }
});


test('legacy opted-in guardian copies are cancelled before their due date while only the uploader is sent', async () => {
  const { db, sqlite, enqueue } = database();
  try {
    const copyId = crypto.randomUUID();
    enqueue(copyId, 'adult-2', 'other@example.invalid');
    sqlite.prepare("UPDATE email_outbox SET next_attempt_at='2027-01-01T00:00:00.000Z' WHERE id=?").run(copyId);
    let calls = 0;
    const result = await sendOutboxBatch(db, actor, live, { now, limit: 1, fetcher: async (_url, init) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init?.body)).to, [{email:message.recipientEmail,name:message.recipientName}]);
      return Response.json({messageId:'<uploader@fixture>'},{status:201});
    } });
    assert.equal(calls, 1);
    assert.equal(result.dailyAttempts, 1);
    assert.equal(result.results.find(row => row.id === copyId)?.status, 'cancelled');
    assert.equal(sqlite.prepare('SELECT recipient_email FROM email_outbox WHERE id=?').get(copyId)?.recipient_email, 'other@example.invalid');
  } finally { sqlite.close(); }
});

test('legacy guardian and staff uploader rows cannot be retried or retargeted', async () => {
  for (const staffAssisted of [false, true]) for (const status of ['queued','dry_run','blocked','rejected']) {
    const { db, sqlite, enqueue } = database({staffAssisted});
    try {
      sqlite.prepare('DELETE FROM email_outbox').run();
      enqueue(id, staffAssisted ? actor.id : 'adult-2', staffAssisted ? actor.email : 'other@example.invalid');
      sqlite.prepare("UPDATE email_outbox SET status=?,last_error_code=? WHERE id=?").run(status, status === 'blocked' ? 'missing_configuration' : 'provider_limit', id);
      const before = sqlite.prepare('SELECT recipient_id,recipient_email,recipient_name FROM email_outbox WHERE id=?').get(id);
      assert.equal(await retryEmailOutbox(db, actor, id, new Date(now.getTime()+86400000)), false);
      assert.equal(sqlite.prepare('SELECT status FROM email_outbox WHERE id=?').get(id)?.status, 'cancelled');
      assert.deepEqual(sqlite.prepare('SELECT recipient_id,recipient_email,recipient_name FROM email_outbox WHERE id=?').get(id), before);
    } finally { sqlite.close(); }
  }
});

test('staff-assisted legacy rows send only the designated adult and cancel staff or other guardians', async () => {
  const { db, sqlite, enqueue } = database({staffAssisted:true});
  try {
    enqueue(crypto.randomUUID(), actor.id, actor.email);
    enqueue(crypto.randomUUID(), 'adult-2', 'other@example.invalid');
    let calls = 0;
    const result = await sendOutboxBatch(db, actor, live, {now,fetcher:async (_url,init) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init?.body)).to,[{email:message.recipientEmail,name:message.recipientName}]);
      return Response.json({messageId:'<designated@fixture>'},{status:201});
    }});
    assert.equal(calls, 1);
    assert.equal(result.dailyAttempts, 1);
    assert.equal(result.results.length, 3);
    assert.equal(result.results.filter(row => row.status === 'cancelled').length,2);
    assert.equal(result.results.find(row => row.id === id)?.status,'accepted');
    assert.equal(sqlite.prepare('SELECT status FROM payments WHERE id=?').get('payment-1')?.status, 'verified');
    assert.equal(sqlite.prepare('SELECT status FROM receipts WHERE id=?').get('receipt-1')?.status, 'issued');
  } finally { sqlite.close(); }
});

test('an issued receipt row cannot send mail before bank verification', async () => {
  const { db, sqlite } = database({verified:false});
  try {
    const result = await sendOutboxBatch(db, actor, live, {now,fetcher:async () => { throw new Error('Must not fetch'); }});
    assert.equal(result.results[0]?.status, 'cancelled');
    assert.equal(result.dailyAttempts, 0);
    assert.equal(await retryEmailOutbox(db, actor, id, new Date(now.getTime()+86400000)), false);
  } finally { sqlite.close(); }
});

test('void legacy copies are cancelled while the selected uploader or designated adult receives the notice', async () => {
  for (const staffAssisted of [false,true]) {
  const { db, sqlite, enqueue } = database({staffAssisted});
  try {
    sqlite.prepare("UPDATE payments SET status='void' WHERE id=?").run('payment-1');
    sqlite.prepare("UPDATE receipts SET status='void',void_reason='Anulación sintética',voided_at=? WHERE id=?").run(now.toISOString(),'receipt-1');
    const uploaderVoid = crypto.randomUUID(), copyVoid = crypto.randomUUID();
    enqueue(uploaderVoid,'adult-1',message.recipientEmail,'receipt_void');
    enqueue(copyVoid,'adult-2','other@example.invalid','receipt_void');
    let calls = 0;
    const result = await sendOutboxBatch(db, actor, live, {now,fetcher:async (_url,init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.to,[{email:message.recipientEmail,name:message.recipientName}]);
      assert.match(body.subject,/ANULADO/);
      return Response.json({messageId:'<void-uploader@fixture>'},{status:201});
    }});
    assert.equal(calls,1);
    assert.equal(result.results.find(row => row.id === copyVoid)?.status,'cancelled');
    assert.equal(result.results.find(row => row.id === uploaderVoid)?.status,'accepted');
  } finally { sqlite.close(); }
  }
});

test('a revoked, changed-address or inactive uploader cannot requeue safe retry states', async () => {
  for (const staffAssisted of [false,true]) for (const change of ['link','email','inactive']) {
    const { db, sqlite } = database({staffAssisted});
    try {
      sqlite.prepare("UPDATE email_outbox SET status='blocked',last_error_code='missing_configuration' WHERE id=?").run(id);
      if(change==='link') sqlite.prepare("UPDATE guardian_links SET active=0 WHERE user_id='adult-1'").run();
      if(change==='email') sqlite.prepare("UPDATE users SET email='changed@example.invalid' WHERE id='adult-1'").run();
      if(change==='inactive') sqlite.prepare("UPDATE users SET active=0 WHERE id='adult-1'").run();
      assert.equal(await retryEmailOutbox(db,actor,id,now),false);
      assert.equal(sqlite.prepare('SELECT status FROM email_outbox WHERE id=?').get(id)?.status,'cancelled');
      assert.equal(sqlite.prepare('SELECT recipient_email FROM email_outbox WHERE id=?').get(id)?.recipient_email,message.recipientEmail);
    } finally { sqlite.close(); }
  }
});


test('the atomic send claim rechecks selected recipient authorization after the queue scan', async () => {
  for (const staffAssisted of [false,true]) {
  const { db, sqlite } = database({staffAssisted});
  try {
    const originalBatch = db.batch.bind(db);
    let invalidated = false, calls = 0;
    db.batch = async statements => {
      if (!invalidated) {
        invalidated = true;
        sqlite.prepare("UPDATE guardian_links SET active=0 WHERE user_id='adult-1'").run();
      }
      return originalBatch(statements);
    };
    const fetcher = async () => { calls++; throw new Error('Must not fetch'); };
    const result = await sendOutboxBatch(db, actor, live, {now,fetcher});
    assert.equal(calls,0);
    assert.equal(result.dailyAttempts,0);
    assert.equal(result.processed,0);
    const cleanup = await sendOutboxBatch(db, actor, live, {now,fetcher});
    assert.equal(cleanup.results[0]?.status,'cancelled');
    assert.equal(calls,0);
  } finally { sqlite.close(); }
  }
});


test('staff-assisted designated adults can safely retry the same stored UUID after configuration is repaired', async () => {
  const {db,sqlite} = database({staffAssisted:true});
  try {
    sqlite.prepare("UPDATE email_outbox SET status='blocked',last_error_code='missing_configuration' WHERE id=?").run(id);
    assert.equal(await retryEmailOutbox(db,actor,id,now),true);
    let calls=0;
    const result=await sendOutboxBatch(db,actor,live,{now,fetcher:async (_url,init)=>{
      calls++;
      const body=JSON.parse(String(init?.body));
      assert.equal(body.headers.idempotencyKey,id);
      assert.deepEqual(body.to,[{email:message.recipientEmail,name:message.recipientName}]);
      return Response.json({messageId:'<retry-designated@fixture>'},{status:201});
    }});
    assert.equal(calls,1);
    assert.equal(result.results[0]?.status,'accepted');
  } finally {sqlite.close();}
});

test('invalid legacy designated addresses are cancelled before sending or retrying even when the account still matches', async () => {
  for (const email of ['', 'invalid-address', 'two@example.invalid,other@example.invalid']) for(const retry of [false,true]) {
    const {db,sqlite,enqueue}=database({staffAssisted:true});
    try {
      sqlite.prepare('DELETE FROM email_outbox').run();
      sqlite.prepare("UPDATE users SET email=? WHERE id='adult-1'").run(email);
      enqueue(id,'adult-1',email);
      if(retry){
        sqlite.prepare("UPDATE email_outbox SET status='blocked',last_error_code='missing_configuration'").run();
        assert.equal(await retryEmailOutbox(db,actor,id,now),false);
      } else {
        sqlite.prepare("UPDATE email_outbox SET next_attempt_at='2027-01-01T00:00:00.000Z'").run();
        const result=await sendOutboxBatch(db,actor,live,{now,fetcher:async()=>{throw new Error('Must not fetch');}});
        assert.equal(result.dailyAttempts,0);
      }
      assert.equal(sqlite.prepare('SELECT status FROM email_outbox WHERE id=?').get(id)?.status,'cancelled');
      assert.equal(sqlite.prepare('SELECT recipient_email FROM email_outbox WHERE id=?').get(id)?.recipient_email,email);
    } finally {sqlite.close();}
  }
});

test('missing designated account cannot send or retry and a cancelled legacy row never revives automatically',async()=>{
  for(const missing of [true,false]){
    const {db,sqlite}=database({staffAssisted:true});
    try{
      if(missing){ sqlite.exec('PRAGMA foreign_keys=OFF'); sqlite.prepare("DELETE FROM users WHERE id='adult-1'").run(); }
      else sqlite.prepare("UPDATE email_outbox SET status='cancelled',last_error_code='recipient_or_receipt_changed'").run();
      const result=await sendOutboxBatch(db,actor,live,{now,fetcher:async()=>{throw new Error('Must not fetch');}});
      assert.equal(result.dailyAttempts,0);
      assert.equal(await retryEmailOutbox(db,actor,id,now),false);
      assert.equal(sqlite.prepare('SELECT status FROM email_outbox WHERE id=?').get(id)?.status,'cancelled');
    }finally{sqlite.close();}
  }
});


test('deliberate first-email preparation is atomic, audited once, and unchanged by concurrent or later replay',async()=>{
  for(const staffAssisted of [false,true]) {
    const {db,sqlite}=database({staffAssisted});
    try {
      sqlite.prepare('DELETE FROM email_outbox').run();
      const before={payment:sqlite.prepare('SELECT * FROM payments').all(),receipt:sqlite.prepare('SELECT * FROM receipts').all()};
      const [first,second]=await Promise.all([prepareReceiptEmail(db,actor,'receipt-1',now),prepareReceiptEmail(db,actor,'receipt-1',now)]);
      assert.equal(Number(first.created)+Number(second.created),1);
      assert.equal(first.outboxId,second.outboxId);
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM email_outbox').get()?.n,1);
      const queued=sqlite.prepare('SELECT * FROM email_outbox').get()!;
      assert.equal(queued.recipient_id,'adult-1');
      assert.equal(queued.recipient_email,message.recipientEmail);
      assert.equal(queued.status,'queued');
      const audits=sqlite.prepare("SELECT detail_json FROM audit_events WHERE action='prepare_email'").all();
      assert.equal(audits.length,1);
      const detail=JSON.parse(String(audits[0]!.detail_json));
      assert.equal(detail.outboxId,first.outboxId);
      assert.equal(detail.emailRecipientUserId,'adult-1');
      assert.equal(detail.emailRecipientPolicy,staffAssisted?'designated_adult':'uploader_only');
      assert.deepEqual(await prepareReceiptEmail(db,actor,'receipt-1',now),{outboxId:first.outboxId,created:false});
      assert.deepEqual(sqlite.prepare('SELECT * FROM payments').all(),before.payment);
      assert.deepEqual(sqlite.prepare('SELECT * FROM receipts').all(),before.receipt);
      assert.deepEqual(sqlite.prepare('SELECT * FROM email_outbox').get(),queued);
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='prepare_email'").get()?.n,1);
    }finally{sqlite.close();}
  }
});

test('preparation recovers after a lost committed response without a second email or audit',async()=>{
  const {db,sqlite}=database({staffAssisted:true});
  try{
    sqlite.prepare('DELETE FROM email_outbox').run();
    const original=db.batch.bind(db);
    db.batch=async statements=>{await original(statements);db.batch=original;throw new Error('Synthetic lost response');};
    await assert.rejects(prepareReceiptEmail(db,actor,'receipt-1',now),/Synthetic lost response/);
    const result=await prepareReceiptEmail(db,actor,'receipt-1',now);
    assert.equal(result.created,false);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM email_outbox').get()?.n,1);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='prepare_email'").get()?.n,1);
  }finally{sqlite.close();}
});

test('failed preparation audit rolls back its new outbox and allows a later deliberate attempt',async()=>{
  const {db,sqlite}=database({staffAssisted:true});
  try{
    sqlite.prepare('DELETE FROM email_outbox').run();
    sqlite.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic_audit_failure'); END;");
    await assert.rejects(prepareReceiptEmail(db,actor,'receipt-1',now),/synthetic_audit_failure/);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM email_outbox').get()?.n,0);
    sqlite.exec('DROP TRIGGER synthetic_audit_failure');
    assert.equal((await prepareReceiptEmail(db,actor,'receipt-1',now)).created,true);
  }finally{sqlite.close();}
});

test('preparation cannot retarget or revive any existing original outbox including legacy copies',async()=>{
  for(const status of ['queued','sending','dry_run','accepted','blocked','rejected','unknown','cancelled']) for(const legacy of [false,true]){
    const {db,sqlite,enqueue}=database({staffAssisted:true});
    try{
      if(legacy){sqlite.prepare('DELETE FROM email_outbox').run();enqueue(id,'adult-2','other@example.invalid');}
      sqlite.prepare('UPDATE email_outbox SET status=?').run(status);
      const before=sqlite.prepare('SELECT * FROM email_outbox').all();
      await assert.rejects(prepareReceiptEmail(db,actor,'receipt-1',now),{status:409,code:'existing_receipt_email'});
      assert.deepEqual(sqlite.prepare('SELECT * FROM email_outbox').all(),before);
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='prepare_email'").get()?.n,0);
    }finally{sqlite.close();}
  }
});

test('preparation requires active identified recipient, valid current address, every link, and matching frozen identity',async()=>{
  for(const condition of ['inactive','invalid','empty','missing','link','identity']){
    const {db,sqlite}=database({staffAssisted:true,...(condition==='identity'?{snapshotAdultId:'adult-2'}:{})});
    try{
      sqlite.prepare('DELETE FROM email_outbox').run();
      if(condition==='inactive')sqlite.prepare("UPDATE users SET active=0 WHERE id='adult-1'").run();
      if(condition==='invalid')sqlite.prepare("UPDATE users SET email='invalid address' WHERE id='adult-1'").run();
      if(condition==='empty')sqlite.prepare("UPDATE users SET email='' WHERE id='adult-1'").run();
      if(condition==='missing'){sqlite.exec('PRAGMA foreign_keys=OFF');sqlite.prepare("DELETE FROM users WHERE id='adult-1'").run();}
      if(condition==='link')sqlite.prepare("UPDATE guardian_links SET active=0 WHERE user_id='adult-1'").run();
      await assert.rejects(prepareReceiptEmail(db,actor,'receipt-1',now),{status:409,code:'recipient_pending'});
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM email_outbox').get()?.n,0);
      assert.equal(sqlite.prepare("SELECT status FROM payments WHERE id='payment-1'").get()?.status,'verified');
      assert.equal(sqlite.prepare("SELECT status FROM receipts WHERE id='receipt-1'").get()?.status,'issued');
    }finally{sqlite.close();}
  }
});

test('preparation compare-and-insert rechecks address, links, account activity and receipt state',async()=>{
  for(const change of ['email','link','inactive','void']){
    const {db,sqlite}=database({staffAssisted:true});
    try{
      sqlite.prepare('DELETE FROM email_outbox').run();
      const original=db.batch.bind(db);
      db.batch=async statements=>{
        if(change==='email')sqlite.prepare("UPDATE users SET email='new@example.invalid' WHERE id='adult-1'").run();
        if(change==='link')sqlite.prepare("UPDATE guardian_links SET active=0 WHERE user_id='adult-1'").run();
        if(change==='inactive')sqlite.prepare("UPDATE users SET active=0 WHERE id='adult-1'").run();
        if(change==='void'){
          sqlite.prepare("UPDATE payments SET status='void' WHERE id='payment-1'").run();
          sqlite.prepare("UPDATE receipts SET status='void',void_reason='Anulado',voided_at=? WHERE id='receipt-1'").run(now.toISOString());
        }
        return original(statements);
      };
      await assert.rejects(prepareReceiptEmail(db,actor,'receipt-1',now),{status:409,code:'recipient_pending'});
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM email_outbox').get()?.n,0);
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='prepare_email'").get()?.n,0);
    }finally{sqlite.close();}
  }
});

test('first-email preparation rejects unauthorised actors, missing receipts, unconfirmed funds and voids',async()=>{
  const {db,sqlite}=database({staffAssisted:true,verified:false});
  try{
    sqlite.prepare('DELETE FROM email_outbox').run();
    await assert.rejects(prepareReceiptEmail(db,{...actor,isAdmin:false},'receipt-1',now),{status:403});
    await assert.rejects(prepareReceiptEmail(db,actor,'missing',now),{status:404,code:'not_found'});
    await assert.rejects(prepareReceiptEmail(db,actor,'receipt-1',now),{status:409,code:'conflict'});
    sqlite.prepare("UPDATE users SET active=0 WHERE id=?").run(actor.id);
    await assert.rejects(prepareReceiptEmail(db,actor,'receipt-1',now),{status:403,code:'forbidden'});
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM email_outbox').get()?.n,0);
  }finally{sqlite.close();}
});

test('the shared mutation guard denies parent or foreign-origin first-email requests before preparation',async()=>{
  for(const condition of ['parent','origin','valid']){
    const {db,sqlite}=database({staffAssisted:true});
    try{
      sqlite.prepare('DELETE FROM email_outbox').run();
      const localActor=condition==='parent'?{...actor,id:'adult-1',isAdmin:false}:actor;
      const url=new URL('https://payments.example/api/admin/email');
      const request=new Request(url,{method:'POST',headers:{origin:condition==='origin'?'https://other.example':url.origin},body:new URLSearchParams({action:'prepare',receiptId:'receipt-1'})});
      const context={request,url,locals:{portalActor:localActor}} as Parameters<typeof portalMutation>[0];
      const response=await portalMutation(context,{PORTAL_ENABLED:'true',DB:db} as Cloudflare.Env,{admin:true,back:'/admin/comprobantes'},async(user,form)=>{
        await prepareReceiptEmail(db,user,formText(form,'receiptId',80),now);
        return successRedirect('/admin/comprobantes','email_prepared');
      });
      assert.equal(response.status,condition==='valid'?303:403);
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM email_outbox').get()?.n,condition==='valid'?1:0);
      if(condition==='valid')assert.equal(response.headers.get('location'),'/admin/comprobantes?notice=email_prepared');
    }finally{sqlite.close();}
  }
});

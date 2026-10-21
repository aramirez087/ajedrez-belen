import { getPaymentDetail, billingPeriod } from "./domain";
import { hasApprovedAthlete } from "./membership";
import { PortalError, type Actor, type SlipMetadata } from "./types";
import { detectSlipType } from "../prototype-policy";
import { extractPayslip, type OcrSuggestions } from "./ocr-provider";
export type { OcrSuggestions } from "./ocr-provider";

export interface SlipDraft extends SlipMetadata {
  id: string;
  ownerId: string;
  createdAt: string;
  expiresAt: string;
  state: "draft" | "attached" | "deleting" | "deleted";
  paymentFileId: string | null;
}
export interface SlipExtraction {
  id: string;
  draftId: string;
  status: "ready" | "failed" | "unavailable" | "sending";
  suggestions: OcrSuggestions | null;
  model: string | null;
  code: string | null;
  mode: "demo" | "groq";
  createdAt: string;
  sourceKind: "original" | "pdf_preview";
  sourceSha256: string;
}
export interface OcrEnvironment {
  SLIPS: R2Bucket;
  OCR_MODE?: string;
  GROQ_API_KEY?: string;
  GROQ_VISION_MODEL?: string;
  GROQ_TIMEOUT_MS?: string;
}
export interface ExtractionOptions {
  derivedImage?: {
    bytes: ArrayBuffer;
    contentType: "image/png" | "image/jpeg";
  };
  /** Set only by the server's DEV + loopback check, never by a form parameter. */
  demoAllowed?: boolean;
  now?: Date;
  fetcher?: typeof fetch;
}
const draftColumns =
  "id,owner_id AS ownerId,object_key AS key,file_type AS type,file_size AS size,file_sha256 AS sha256,created_at AS createdAt,expires_at AS expiresAt,state,payment_file_id AS paymentFileId";
const extractionColumns =
  "id,draft_id AS draftId,status,suggestions_json AS suggestionsJson,model,error_code AS code,mode,created_at AS createdAt,source_kind AS sourceKind,source_sha256 AS sourceSha256";
type ExtractionRow = Omit<SlipExtraction, "suggestions"> & {
  suggestionsJson: string | null;
};
function output(row: ExtractionRow): SlipExtraction {
  const { suggestionsJson, ...result } = row;
  return {
    ...result,
    suggestions: suggestionsJson ? JSON.parse(suggestionsJson) : null,
  };
}
function sql(db: D1Database, query: string, values: unknown[] = []) {
  return db.prepare(query).bind(...values);
}
function error(status: number, code: string): never {
  throw new PortalError(status, code, code);
}
async function transaction(db: D1Database, statements: D1PreparedStatement[]) {
  try {
    return await db.batch(statements);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/draft_limit/.test(message)) error(409, "draft_limit");
    if (
      /draft_unavailable|draft_file_mismatch|financial_evidence_referenced|constraint|UNIQUE/i.test(
        message,
      )
    )
      error(409, "draft_expired");
    throw cause;
  }
}
async function hash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function assertCanUploadSlip(
  db: D1Database,
  actor: Actor,
): Promise<void> {
  const account = await sql(db, "SELECT active FROM users WHERE id=?", [
    actor.id,
  ]).first<{ active: number }>();
  if (account?.active !== 1) error(403, "forbidden");
  if (!actor.isAdmin && !(await hasApprovedAthlete(db, actor.id)))
    error(403, "forbidden");
}
/** Reserve before R2 put so interrupted uploads remain tracked for safe cleanup. */
export async function registerSlipDraft(
  db: D1Database,
  actor: Actor,
  input: SlipMetadata & { id?: string },
  now = new Date(),
): Promise<SlipDraft> {
  await assertCanUploadSlip(db, actor);
  if (
    !input.key.startsWith("portal/") ||
    input.key.length > 200 ||
    !["image/png", "image/jpeg", "application/pdf"].includes(input.type) ||
    !Number.isSafeInteger(input.size) ||
    input.size < 8 ||
    input.size > 3145728 ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  )
    error(400, "invalid_image");
  const draftId = input.id || crypto.randomUUID();
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(draftId)) error(400, "invalid_image");
  const createdAt = now.toISOString(),
    expiresAt = new Date(now.getTime() + 3600000).toISOString();
  await transaction(db, [
    sql(
      db,
      "INSERT INTO slip_drafts(id,owner_id,object_key,file_type,file_size,file_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
      [
        draftId,
        actor.id,
        input.key,
        input.type,
        input.size,
        input.sha256,
        createdAt,
        expiresAt,
      ],
    ),
  ]);
  return getSlipDraft(db, actor, draftId);
}
export async function getSlipDraft(
  db: D1Database,
  actor: Actor,
  draftId: string,
): Promise<SlipDraft> {
  await assertCanUploadSlip(db, actor);
  const draft = await sql(
    db,
    `SELECT ${draftColumns} FROM slip_drafts WHERE id=? AND owner_id=? AND state NOT IN ('deleted','deleting')`,
    [draftId, actor.id],
  ).first<SlipDraft>();
  if (!draft) error(404, "draft_not_found");
  return draft;
}
export async function getDraftForSubmission(
  db: D1Database,
  actor: Actor,
  draftId: string,
  now = new Date(),
): Promise<SlipMetadata> {
  const draft = await getSlipDraft(db, actor, draftId);
  if (
    draft.state !== "draft" ||
    draft.expiresAt <= now.toISOString() ||
    (await sql(db, "SELECT id FROM payment_files WHERE file_key=?", [
      draft.key,
    ]).first())
  )
    error(409, "draft_expired");
  return {
    key: draft.key,
    type: draft.type,
    size: draft.size,
    sha256: draft.sha256,
  };
}
/** Financial key references are authoritative even if this follow-up is interrupted. */
export async function attachSlipDraft(
  db: D1Database,
  actor: Actor,
  draftId: string,
  paymentId: string,
): Promise<void> {
  const draft = await getSlipDraft(db, actor, draftId);
  const sameAttachment = () =>
    sql(
      db,
      "SELECT 1 FROM slip_drafts d JOIN payment_files f ON f.id=d.payment_file_id JOIN payment_revisions r ON r.payment_id=f.payment_id AND r.revision=f.revision WHERE d.id=? AND d.owner_id=? AND d.state='attached' AND f.payment_id=? AND f.file_key=d.object_key AND r.recorded_by=?",
      [draft.id, actor.id, paymentId, actor.id],
    ).first();
  if (draft.state === "attached") {
    if (await sameAttachment()) return;
    error(409, "draft_expired");
  }
  const result = await transaction(db, [
    sql(
      db,
      "UPDATE slip_drafts SET state='attached',payment_file_id=(SELECT f.id FROM payment_files f JOIN payment_revisions r ON r.payment_id=f.payment_id AND r.revision=f.revision WHERE f.file_key=slip_drafts.object_key AND f.payment_id=? AND r.recorded_by=?) WHERE id=? AND owner_id=? AND state='draft' AND EXISTS(SELECT 1 FROM payment_files WHERE file_key=slip_drafts.object_key AND payment_id=?)",
      [paymentId, actor.id, draft.id, actor.id, paymentId],
    ),
  ]);
  if (!result[0].meta.changes && !(await sameAttachment()))
    error(409, "draft_expired");
}
export async function getLatestExtraction(
  db: D1Database,
  actor: Actor,
  draftId: string,
): Promise<SlipExtraction | null> {
  await getSlipDraft(db, actor, draftId);
  const row = await sql(
    db,
    `SELECT ${extractionColumns} FROM slip_extractions WHERE draft_id=? AND owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    [draftId, actor.id],
  ).first<ExtractionRow>();
  return row ? output(row) : null;
}
export async function getPaymentExtractions(
  db: D1Database,
  actor: Actor,
  paymentId: string,
): Promise<
  Array<{ fileId: string; revision: number; extraction: SlipExtraction }>
> {
  const detail = await getPaymentDetail(db, actor, paymentId);
  const found = [];
  for (const file of detail.files) {
    const row = await sql(
      db,
      `SELECT ${extractionColumns
        .split(",")
        .map((c) => `e.${c}`)
        .join(
          ",",
        )} FROM slip_extractions e JOIN slip_drafts d ON d.id=e.draft_id WHERE d.object_key=? AND d.file_sha256=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1`,
      [file.key, file.sha256],
    ).first<ExtractionRow>();
    if (row)
      found.push({
        fileId: file.id,
        revision: file.revision,
        extraction: output(row),
      });
  }
  return found;
}

function demoSuggestions(now: Date): OcrSuggestions {
  const day = new Intl.DateTimeFormat("en", {
    timeZone: "America/Costa_Rica",
    day: "2-digit",
  }).format(now);
  return {
    amount: "12000.00",
    currency: "CRC",
    transferDate: `${billingPeriod(now.toISOString())}-${day}`,
    payerName: "Familia ficticia de demostración",
    bankReference: "00002026101000000000123456",
    description: "Timothy · muestra fija de demostración",
    warnings: ["demo_fixture"],
  };
}
async function loadImage(
  draft: SlipDraft,
  env: OcrEnvironment,
  options: ExtractionOptions,
) {
  const object = await env.SLIPS.get(draft.key);
  if (!object) error(404, "original_missing");
  if (object.size !== draft.size) error(400, "invalid_image");
  const original = await object.arrayBuffer();
  if (
    (await hash(original)) !== draft.sha256 ||
    detectSlipType(new Uint8Array(original)) !== draft.type
  )
    error(400, "invalid_image");
  if (draft.type === "application/pdf") {
    const image = options.derivedImage;
    if (!image) error(400, "ocr_pdf_preview_required");
    if (
      image.bytes.byteLength < 8 ||
      image.bytes.byteLength > 1572864 ||
      detectSlipType(new Uint8Array(image.bytes)) !== image.contentType
    )
      error(400, "invalid_image");
    return {
      image,
      sourceKind: "pdf_preview" as const,
      sourceSha256: await hash(image.bytes),
    };
  }
  if (options.derivedImage) error(400, "invalid_image");
  return {
    image: {
      bytes: original,
      contentType: draft.type as "image/png" | "image/jpeg",
    },
    sourceKind: "original" as const,
    sourceSha256: draft.sha256,
  };
}
export async function requestSlipExtraction(
  db: D1Database,
  actor: Actor,
  draftId: string,
  env: OcrEnvironment,
  options: ExtractionOptions = {},
): Promise<SlipExtraction> {
  const mode = env.OCR_MODE;
  if (mode !== "demo" && mode !== "groq") error(400, "ocr_disabled");
  if (
    mode === "demo" &&
    (actor.mode !== "demo" || options.demoAllowed !== true)
  )
    error(403, "forbidden");
  if (mode === "groq" && actor.mode !== "workos") error(403, "forbidden");
  const now = options.now || new Date(),
    stamp = now.toISOString(),
    draft = await getSlipDraft(db, actor, draftId);
  if (
    draft.state !== "draft" ||
    draft.expiresAt <= stamp ||
    (await sql(db, "SELECT id FROM payment_files WHERE file_key=?", [
      draft.key,
    ]).first())
  )
    error(409, "draft_expired");
  const { image, sourceKind, sourceSha256 } = await loadImage(
    draft,
    env,
    options,
  );
  const cached = await sql(
    db,
    `SELECT ${extractionColumns} FROM slip_extractions WHERE owner_id=? AND file_sha256=? AND source_sha256=? AND mode=? AND status='ready' ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    [actor.id, draft.sha256, sourceSha256, mode],
  ).first<ExtractionRow>();
  if (cached) {
    if (cached.draftId === draftId) return output(cached);
    const copyId = crypto.randomUUID();
    await sql(
      db,
      "INSERT INTO slip_extractions(id,draft_id,owner_id,file_sha256,source_kind,source_sha256,mode,status,suggestions_json,model,claim_token,claim_expires_at,created_at,finished_at) VALUES(?,?,?,?,?,?,?,'ready',?,?,?,?,?,?)",
      [
        copyId,
        draftId,
        actor.id,
        draft.sha256,
        sourceKind,
        sourceSha256,
        mode,
        cached.suggestionsJson,
        cached.model,
        crypto.randomUUID(),
        stamp,
        stamp,
        stamp,
      ],
    ).run();
    return (await getLatestExtraction(db, actor, draftId))!;
  }
  const extractionId = crypto.randomUUID(),
    token = crypto.randomUUID(),
    expires = new Date(now.getTime() + 60000).toISOString(),
    day = stamp.slice(0, 10),
    minute = stamp.slice(0, 16);
  const statements = [
    sql(
      db,
      "UPDATE slip_extractions SET status='failed',error_code='interrupted',finished_at=? WHERE status='sending' AND claim_expires_at<=?",
      [stamp, stamp],
    ),
  ];
  if (mode === "groq")
    statements.push(
      sql(
        db,
        "INSERT OR IGNORE INTO ocr_daily_budget(day,scope,attempts) VALUES(?,'global',0)",
        [day],
      ),
      sql(
        db,
        "INSERT OR IGNORE INTO ocr_daily_budget(day,scope,attempts) VALUES(?,?,0)",
        [day, `user:${actor.id}`],
      ),
      sql(
        db,
        "INSERT OR IGNORE INTO ocr_minute_budget(minute,attempts) VALUES(?,0)",
        [minute],
      ),
    );
  statements.push(
    sql(
      db,
      `INSERT INTO slip_extractions(id,draft_id,owner_id,file_sha256,source_kind,source_sha256,mode,status,claim_token,claim_expires_at,created_at) SELECT ?,d.id,d.owner_id,d.file_sha256,?,?,?,'sending',?,?,? FROM slip_drafts d WHERE d.id=? AND d.owner_id=? AND d.state='draft' AND d.expires_at>? AND NOT EXISTS(SELECT 1 FROM payment_files WHERE file_key=d.object_key) AND NOT EXISTS(SELECT 1 FROM slip_extractions WHERE draft_id=d.id AND status='sending' AND claim_expires_at>?) AND (SELECT count(*) FROM slip_extractions WHERE draft_id=d.id AND substr(created_at,1,10)=?)<3 ${mode === "groq" ? "AND NOT EXISTS(SELECT 1 FROM slip_extractions WHERE mode='groq' AND status='sending' AND claim_expires_at>?) AND (SELECT attempts FROM ocr_daily_budget WHERE day=? AND scope='global')<50 AND (SELECT attempts FROM ocr_daily_budget WHERE day=? AND scope=?)<10 AND (SELECT attempts FROM ocr_minute_budget WHERE minute=?)<2" : ""}`,
      [
        extractionId,
        sourceKind,
        sourceSha256,
        mode,
        token,
        expires,
        stamp,
        draftId,
        actor.id,
        stamp,
        stamp,
        day,
        ...(mode === "groq"
          ? [stamp, day, day, `user:${actor.id}`, minute]
          : []),
      ],
    ),
  );
  const claimIndex = statements.length - 1;
  if (mode === "groq") {
    statements.push(
      sql(
        db,
        "UPDATE ocr_daily_budget SET attempts=attempts+1 WHERE day=? AND scope IN ('global',?) AND EXISTS(SELECT 1 FROM slip_extractions WHERE id=? AND claim_token=?)",
        [day, `user:${actor.id}`, extractionId, token],
      ),
      sql(
        db,
        "UPDATE ocr_minute_budget SET attempts=attempts+1 WHERE minute=? AND EXISTS(SELECT 1 FROM slip_extractions WHERE id=? AND claim_token=?)",
        [minute, extractionId, token],
      ),
    );
  }
  const results = await transaction(db, statements);
  if (!results[claimIndex].meta.changes) {
    const busy = await sql(
      db,
      "SELECT 1 FROM slip_extractions WHERE status='sending' AND claim_expires_at>? AND (draft_id=? OR (mode='groq' AND ?='groq')) LIMIT 1",
      [stamp, draftId, mode],
    ).first();
    error(busy ? 409 : 429, busy ? "ocr_busy" : "ocr_limit");
  }
  let result: Awaited<ReturnType<typeof extractPayslip>>;
  try {
    result =
      mode === "demo"
        ? {
            status: "ready",
            suggestions: demoSuggestions(now),
            model: "fixed-demo-fixture",
          }
        : await extractPayslip(env, image, { fetcher: options.fetcher, now });
  } catch {
    result = {
      status: "failed",
      code: "network_or_timeout",
      model: env.GROQ_VISION_MODEL || "unknown",
    };
  }
  await sql(
    db,
    "UPDATE slip_extractions SET status=?,suggestions_json=?,model=?,error_code=?,finished_at=? WHERE id=? AND claim_token=? AND status='sending'",
    [
      result.status,
      result.status === "ready" ? JSON.stringify(result.suggestions) : null,
      result.model,
      result.status === "ready" ? null : result.code,
      new Date().toISOString(),
      extractionId,
      token,
    ],
  ).run();
  const row = await sql(
    db,
    `SELECT ${extractionColumns} FROM slip_extractions WHERE id=? AND owner_id=?`,
    [extractionId, actor.id],
  ).first<ExtractionRow>();
  return output(row!);
}

/** Admin maintenance only: never delete any object referenced by financial evidence. */
async function cleanupDraftRows(
  db: D1Database,
  actor: Actor,
  bucket: R2Bucket,
  limit: number,
  now: Date,
  ownOnly: boolean,
): Promise<{ deleted: number; retained: number }> {
  const cutoff = new Date(now.getTime() - 3600000).toISOString(),
    maximum = Math.max(1, Math.min(50, Math.trunc(limit)));
  const rows = (
    await sql(
      db,
      `SELECT ${draftColumns} FROM slip_drafts WHERE state IN ('draft','deleting') AND expires_at<=? ${ownOnly ? "AND owner_id=?" : ""} ORDER BY expires_at LIMIT ?`,
      [cutoff, ...(ownOnly ? [actor.id] : []), maximum],
    ).all<SlipDraft>()
  ).results;
  let deleted = 0,
    retained = 0;
  for (const draft of rows) {
    const reference = await sql(
      db,
      "SELECT id FROM payment_files WHERE file_key=?",
      [draft.key],
    ).first<{ id: string }>();
    if (reference) {
      await sql(
        db,
        "UPDATE slip_drafts SET state='attached',payment_file_id=? WHERE id=? AND state IN ('draft','deleting')",
        [reference.id, draft.id],
      ).run();
      retained++;
      continue;
    }
    const token = crypto.randomUUID();
    const claim = await sql(
      db,
      "UPDATE slip_drafts SET state='deleting',cleanup_token=? WHERE id=? AND state IN ('draft','deleting') AND expires_at<=? AND NOT EXISTS(SELECT 1 FROM payment_files WHERE file_key=slip_drafts.object_key) AND NOT EXISTS(SELECT 1 FROM slip_extractions WHERE draft_id=slip_drafts.id AND status='sending' AND claim_expires_at>?)",
      [token, draft.id, cutoff, now.toISOString()],
    ).run();
    if (!claim.meta.changes) {
      retained++;
      continue;
    }
    if (
      await sql(db, "SELECT id FROM payment_files WHERE file_key=?", [
        draft.key,
      ]).first()
    ) {
      retained++;
      continue;
    }
    try {
      await bucket.delete(draft.key);
      const finished = await sql(
        db,
        "UPDATE slip_drafts SET state='deleted' WHERE id=? AND cleanup_token=? AND state='deleting' AND NOT EXISTS(SELECT 1 FROM payment_files WHERE file_key=slip_drafts.object_key)",
        [draft.id, token],
      ).run();
      if (finished.meta.changes) deleted++;
      else retained++;
    } catch {
      retained++;
    }
  }
  return { deleted, retained };
}
export async function cleanupExpiredDrafts(
  db: D1Database,
  actor: Actor,
  bucket: R2Bucket,
  limit = 20,
  now = new Date(),
): Promise<{ deleted: number; retained: number }> {
  if (!actor.isAdmin) error(403, "forbidden");
  await assertCanUploadSlip(db, actor);
  return cleanupDraftRows(db, actor, bucket, limit, now, false);
}
export async function cleanupOwnExpiredDrafts(
  db: D1Database,
  actor: Actor,
  bucket: R2Bucket,
  limit = 5,
  now = new Date(),
): Promise<{ deleted: number; retained: number }> {
  await assertCanUploadSlip(db, actor);
  return cleanupDraftRows(db, actor, bucket, Math.min(5, limit), now, true);
}

/**
 * A family removes one of its own emailed files. It follows the expiry cleanup's safe sequence
 * (claim the row, delete the object, finish) for one draft that has not expired. If storage
 * fails the claim is undone, so no row is ever left half-deleted. A file a payment references
 * can never be discarded: the claim excludes it and a database trigger backs that up.
 */
export async function discardEmailDraft(
  db: D1Database,
  actor: Actor,
  bucket: R2Bucket,
  draftId: string,
  now = new Date(),
): Promise<void> {
  await assertCanUploadSlip(db, actor);
  const draft = await sql(
    db,
    `SELECT ${draftColumns} FROM slip_drafts WHERE id=? AND owner_id=? AND state='draft' AND EXISTS(SELECT 1 FROM email_inbound WHERE draft_id=slip_drafts.id)`,
    [draftId, actor.id],
  ).first<SlipDraft>();
  if (!draft) error(404, "draft_not_found");
  const token = crypto.randomUUID();
  const claim = await sql(
    db,
    "UPDATE slip_drafts SET state='deleting',cleanup_token=? WHERE id=? AND owner_id=? AND state='draft' AND NOT EXISTS(SELECT 1 FROM payment_files WHERE file_key=slip_drafts.object_key) AND NOT EXISTS(SELECT 1 FROM slip_extractions WHERE draft_id=slip_drafts.id AND status='sending' AND claim_expires_at>?)",
    [token, draft.id, actor.id, now.toISOString()],
  ).run();
  if (!claim.meta.changes) {
    // A file a payment already uses is no longer a loose draft; otherwise only a read in flight can block.
    if (await sql(db, "SELECT 1 AS ok FROM payment_files WHERE file_key=?", [draft.key]).first()) error(404, "draft_not_found");
    if (await sql(db, "SELECT 1 AS ok FROM slip_drafts WHERE id=? AND state='draft'", [draft.id]).first()) error(409, "draft_busy");
    error(404, "draft_not_found");
  }
  try {
    await bucket.delete(draft.key);
    const finished = await sql(
      db,
      "UPDATE slip_drafts SET state='deleted' WHERE id=? AND cleanup_token=? AND state='deleting' AND NOT EXISTS(SELECT 1 FROM payment_files WHERE file_key=slip_drafts.object_key)",
      [draft.id, token],
    ).run();
    if (!finished.meta.changes) throw new Error("discard_not_finished");
  } catch {
    // Put the row back so the file stays listed and can be tried again; nothing is left in 'deleting'.
    await sql(
      db,
      "UPDATE slip_drafts SET state='draft',cleanup_token=NULL WHERE id=? AND cleanup_token=? AND state='deleting'",
      [draft.id, token],
    ).run().catch(() => undefined);
    error(503, "draft_discard_failed");
  }
}

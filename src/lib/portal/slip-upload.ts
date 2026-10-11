import {
  assertCanUploadSlip,
  cleanupOwnExpiredDrafts,
  getDraftForSubmission,
  registerSlipDraft,
} from './ocr';
import { formText, InputError, readSlip } from './http';
import type { Actor, SlipMetadata } from './types';

/** Reserve tracked storage before writing bytes, so interruptions leave a recoverable draft. */
export async function saveSlipDraft(
  env: Cloudflare.Env,
  actor: Actor,
  slip: NonNullable<Awaited<ReturnType<typeof readSlip>>>,
) {
  await assertCanUploadSlip(env.DB, actor);
  await cleanupOwnExpiredDrafts(env.DB, actor, env.SLIPS);
  const key = `portal/drafts/${crypto.randomUUID()}/original`;
  const draft = await registerSlipDraft(env.DB, actor, {
    key, type: slip.contentType, size: slip.size, sha256: slip.sha256,
  });
  await env.SLIPS.put(key, slip.bytes, {
    httpMetadata: { contentType: slip.contentType },
    customMetadata: { sha256: slip.sha256 },
  });
  return draft;
}

export async function resolveSubmissionSlip(
  env: Cloudflare.Env,
  actor: Actor,
  form: FormData,
  options: { optional?: boolean } = {},
): Promise<{ file: SlipMetadata; draftId: string } | null> {
  const draftId = formText(form, 'draftId', 80, true);
  const slip = await readSlip(form, !!draftId || !!options.optional);
  if (draftId) {
    const file = await getDraftForSubmission(env.DB, actor, draftId);
    if (slip && (slip.sha256 !== file.sha256 || slip.size !== file.size || slip.contentType !== file.type)) {
      throw new InputError('draft_mismatch');
    }
    const original = await env.SLIPS.head(file.key);
    if (!original || original.size !== file.size || original.customMetadata?.sha256 !== file.sha256) {
      throw new InputError('original_missing', 404);
    }
    return { file, draftId };
  }
  if (!slip) return null;
  const draft = await saveSlipDraft(env, actor, slip);
  return {
    file: { key: draft.key, type: draft.type, size: draft.size, sha256: draft.sha256 },
    draftId: draft.id,
  };
}

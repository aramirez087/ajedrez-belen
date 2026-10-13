import { recoverPaymentSubmission, submitPayment } from './domain';
import { attachSlipDraft, getSlipDraft } from './ocr';
import { formText, InputError, readSlip } from './http';
import { resolveSubmissionSlip } from './slip-upload';
import type { Actor, SubmitPaymentInput } from './types';

/** Check a committed operation before reserving another draft or writing any original to R2. */
export async function submitPaymentForm(
  env: Cloudflare.Env, actor: Actor, form: FormData, input: Omit<SubmitPaymentInput, 'file'>,
): Promise<string> {
  const draftId = formText(form, 'draftId', 80, true);
  const original = await readSlip(form, Boolean(draftId));
  const metadata = original
    ? { type: original.contentType, size: original.size, sha256: original.sha256 }
    : draftId ? await getSlipDraft(env.DB, actor, draftId) : null;
  if (!metadata) throw new InputError('invalid_file');
  const replay = await recoverPaymentSubmission(env.DB, actor, { ...input, file: metadata });
  if (replay) return replay;

  try {
    const saved = await resolveSubmissionSlip(env, actor, form);
    if (!saved) throw new InputError('invalid_file');
    const paymentId = await submitPayment(env.DB, actor, { ...input, file: saved.file });
    // Financial references retain originals even when this follow-up is interrupted or a competing
    // request won. An unused losing draft remains tracked for the existing bounded cleanup workflow.
    try { await attachSlipDraft(env.DB, actor, saved.draftId, paymentId); } catch { /* Cleanup reconciles references. */ }
    return paymentId;
  } catch (error) {
    // A competing request may commit and attach the draft after our initial lookup. Recover using
    // the already verified original metadata, without reopening evidence or repeating storage writes.
    const committed = await recoverPaymentSubmission(env.DB, actor, { ...input, file: metadata });
    if (committed) return committed;
    throw error;
  }
}

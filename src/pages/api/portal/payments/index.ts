import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { submitPayment } from '../../../../lib/portal/domain';
import { attachSlipDraft } from '../../../../lib/portal/ocr';
import { formText, InputError, parseAllocations, parseMoney, successRedirect } from '../../../../lib/portal/http';
import { portalMutation } from '../../../../lib/portal/routes';
import { resolveSubmissionSlip } from '../../../../lib/portal/slip-upload';

export const prerender = false;
export const POST: APIRoute = context => portalMutation(
  context, env, { upload: true, back: '/portal/pagos/nuevo' }, async (actor, form) => {
    const input = {
      payerName: formText(form, 'payerName'), amountMinor: parseMoney(form.get('amount')),
      transferDate: formText(form, 'transferDate', 10), bankReference: formText(form, 'bankReference', 128),
      allocations: parseAllocations(form),
      designatedAdultId: formText(form, 'designatedAdultId', 80, true) || undefined,
      auditReason: formText(form, 'auditReason', 500, true) || undefined,
      shareEvidence: form.get('shareEvidence') === 'on', note: formText(form, 'note', 500, true) || undefined,
    };
    const saved = await resolveSubmissionSlip(env, actor, form);
    if (!saved) throw new InputError('invalid_file');
    const id = await submitPayment(env.DB, actor, { ...input, file: saved.file });
    // Financial references retain originals even if this bookkeeping step is interrupted.
    try { await attachSlipDraft(env.DB, actor, saved.draftId, id); } catch { /* Cleanup reconciles the reference. */ }
    return successRedirect(`/portal/pagos/${id}`, 'submitted');
  },
);

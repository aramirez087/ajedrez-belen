import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPaymentDetail, revisePayment } from '../../../../../lib/portal/domain';
import { attachSlipDraft } from '../../../../../lib/portal/ocr';
import { formText, parseAllocations, parseMoney, successRedirect } from '../../../../../lib/portal/http';
import { portalMutation, readPaymentReviewSnapshot } from '../../../../../lib/portal/routes';
import { resolveSubmissionSlip } from '../../../../../lib/portal/slip-upload';

export const prerender = false;
export const POST: APIRoute = context => portalMutation(
  context, env, { upload: true, back: `/portal/pagos/${context.params.id}` }, async (actor, form) => {
    const id = context.params.id!;
    await getPaymentDetail(env.DB, actor, id);
    const input = {
      ...readPaymentReviewSnapshot(form),
      payerName: formText(form, 'payerName'), amountMinor: parseMoney(form.get('amount')),
      transferDate: formText(form, 'transferDate', 10), bankReference: formText(form, 'bankReference', 128),
      allocations: parseAllocations(form), note: formText(form, 'note', 500),
    };
    const saved = await resolveSubmissionSlip(env, actor, form, { optional: true });
    await revisePayment(env.DB, actor, id, { ...input, ...(saved ? { file: saved.file } : {}) });
    if (saved) {
      try { await attachSlipDraft(env.DB, actor, saved.draftId, id); } catch { /* Financial references retain the original. */ }
    }
    return successRedirect(`/portal/pagos/${id}`, 'revised');
  },
);

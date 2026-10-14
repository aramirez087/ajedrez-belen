import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPaymentDetail, revisePayment } from '../../../../../lib/portal/domain';
import { attachSlipDraft } from '../../../../../lib/portal/ocr';
import { formBankReference, formText, parseAllocations, parseMoney, successRedirect } from '../../../../../lib/portal/http';
import { formDate } from '../../../../../lib/portal/forms';
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
      transferDate: formDate(form, 'transferDate'), bankReference: formBankReference(form),
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

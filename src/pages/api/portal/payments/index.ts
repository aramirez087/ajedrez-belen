import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { formText, parseAllocations, parseMoney, successRedirect } from '../../../../lib/portal/http';
import { formDate } from '../../../../lib/portal/forms';
import { portalMutation } from '../../../../lib/portal/routes';
import { submitPaymentForm } from '../../../../lib/portal/payment-submission';

export const prerender = false;
export const POST: APIRoute = context => portalMutation(
  context, env, { upload: true, business: true, back: '/portal/pagos/nuevo' }, async (actor, form) => {
    const input = {
      submissionId: formText(form, 'submissionId', 36),
      payerName: formText(form, 'payerName'), amountMinor: parseMoney(form.get('amount')),
      transferDate: formDate(form, 'transferDate'), bankReference: formText(form, 'bankReference', 128),
      allocations: parseAllocations(form),
      designatedAdultId: formText(form, 'designatedAdultId', 80, true) || undefined,
      auditReason: formText(form, 'auditReason', 500, true) || undefined,
      shareEvidence: form.get('shareEvidence') === 'on', note: formText(form, 'note', 500, true) || undefined,
    };
    const id = await submitPaymentForm(env, actor, form, input);
    return successRedirect(`/portal/pagos/${id}`, 'submitted');
  },
);

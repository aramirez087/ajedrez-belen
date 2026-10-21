import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { formBankReference, formText, parseAdvanceMonths, parseAllocations, parseMoney, successRedirect, InputError } from '../../../../lib/portal/http';
import { formDate } from '../../../../lib/portal/forms';
import { portalMutation } from '../../../../lib/portal/routes';
import { submitPaymentForm } from '../../../../lib/portal/payment-submission';

export const prerender = false;
export const POST: APIRoute = context => {
  const assisted = context.url.searchParams.get('context') === 'admin';
  const adult = context.url.searchParams.get('adult') ?? '';
  const validAdult = /^[A-Za-z0-9_-]{1,80}$/.test(adult);
  // Keep an assisted registration in the selected family's form after errors.
  // Requesting this context also requires administration before reading a form.
  const back = assisted
    ? `/admin/pagos/nuevo${validAdult ? `?adult=${encodeURIComponent(adult)}` : ''}`
    : '/portal/pagos/nuevo';
  return portalMutation(
    context, env, { admin: assisted, upload: true, business: true, back }, async (actor, form) => {
      const designatedAdultId = formText(form, 'designatedAdultId', 80, true) || undefined;
      if (assisted && (!validAdult || designatedAdultId !== adult)) throw new InputError('invalid_fields');
      const input = {
        submissionId: formText(form, 'submissionId', 36),
        payerName: formText(form, 'payerName'), amountMinor: parseMoney(form.get('amount')),
        transferDate: formDate(form, 'transferDate'), bankReference: formBankReference(form),
        allocations: parseAllocations(form),
        advance: parseAdvanceMonths(form) > 0,
        designatedAdultId,
        auditReason: formText(form, 'auditReason', 500, true) || undefined,
        shareEvidence: form.get('shareEvidence') === 'on', note: formText(form, 'note', 500, true) || undefined,
      };
      const id = await submitPaymentForm(env, actor, form, input);
      return successRedirect(`${assisted ? '/admin' : '/portal'}/pagos/${id}`, 'submitted');
    },
  );
};

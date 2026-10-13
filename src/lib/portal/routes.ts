import type { APIContext } from 'astro';
import { isSameOriginMutation } from '../auth';
import { authorizePortal } from './access';
import { businessConfigurationUnavailable, formText, InputError, mutationError, portalResponse, readPortalForm } from './http';
import { resolveBusinessConfiguration } from './business-config';
import type { Actor, PaymentReviewSnapshot, PaymentStatus } from './types';

export async function portalMutation(
  context: APIContext,
  env: Cloudflare.Env,
  options: {admin?:boolean;upload?:boolean;business?:boolean;back:string},
  action: (actor: Actor, form: FormData) => Promise<Response>,
): Promise<Response> {
  const access = await authorizePortal(context,env,{admin:options.admin});
  if (!access.ok) return access.response;
  if (!isSameOriginMutation(context.request)) return portalResponse('Invalid origin',403);
  if (options.business && !resolveBusinessConfiguration(context.request, env)) return businessConfigurationUnavailable(context.request);
  try {return await action(access.actor,await readPortalForm(context.request,options.upload));}
  catch(error) {return mutationError(context,error,options.back);}
}

export async function hashInvitationToken(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** A stale browser page must never silently review a different submission. */
export function readPaymentReviewSnapshot(form: FormData): PaymentReviewSnapshot {
  const value = formText(form, 'expectedRevision', 10);
  const status = formText(form, 'expectedStatus', 20);
  const expectedReviewNote = formText(form, 'expectedReviewNote', 500, true) || null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) ||
      !['pending', 'needs_info', 'rejected', 'verified', 'void'].includes(status)) {
    throw new InputError('invalid_fields');
  }
  return { expectedRevision: Number(value), expectedStatus: status as PaymentStatus, expectedReviewNote };
}

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizePrototype, getPrototypeRun, privateResponse, receiptFromRun } from '../../../lib/prototype';
import { hasSameOrigin, readBoundedBody } from '../../../lib/prototype-policy';
import { sendReceiptEmail } from '../../../lib/email';
export const prerender = false;
export const POST: APIRoute = async (context) => {
  const access = await authorizePrototype(context, env);
  if (!access.ok) return access.response;
  if (!hasSameOrigin(context.request, context.url)) return privateResponse('Invalid origin', 403);
  let raw: string;
  try {
    raw = new TextDecoder().decode(await readBoundedBody(context.request, 1024));
  } catch {
    return privateResponse('Request too large', 413);
  }
  const id = new URLSearchParams(raw).get('runId') ?? '';
  const run = await getPrototypeRun(env, access.actor, id);
  if (!run) return privateResponse('Not found', 404);
  if (env.EMAIL_MODE === 'live' && access.actor.mode !== 'workos') {
    return privateResponse('Live email requires WorkOS administrator sign-in', 403);
  }
  // A single atomic claim prevents concurrent clicks or ambiguous-send retries.
  const claim = await env.DB.prepare(`UPDATE prototype_runs SET email_status = 'sending'
    WHERE id = ? AND owner_id = ? AND email_status IN ('not_requested', 'dry_run', 'blocked')`).bind(id, access.actor.id).run();
  if (!claim.meta.changes) return privateResponse('Email already attempted; inspect delivery before retrying.', 409);
  const result = await sendReceiptEmail(env, {
    to: env.EMAIL_TEST_RECIPIENT || 'preview@example.invalid', idempotencyKey: id, receipt: receiptFromRun(run),
  });
  await env.DB.prepare('UPDATE prototype_runs SET email_status = ?, email_provider_id = ? WHERE id = ? AND owner_id = ?')
    .bind(result.status, result.status === 'accepted' ? result.providerMessageId : null, id, access.actor.id).run();
  return privateResponse(null, 303, { Location: `/prototype?notice=${result.status}` });
};

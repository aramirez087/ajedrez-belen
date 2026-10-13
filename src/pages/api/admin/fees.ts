import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ATHLETE_CATEGORIES, updateFeeSchedule } from '../../../lib/portal/domain';
import { parseMoney, successRedirect } from '../../../lib/portal/http';
import { portalMutation } from '../../../lib/portal/routes';
export const prerender = false;
export const POST: APIRoute = context => portalMutation(context, env, { admin: true, back: '/admin/familias' }, async (actor, form) => {
  const fees = Object.fromEntries(ATHLETE_CATEGORIES.map(category => [category, parseMoney(form.get(`fee-${category}`))]));
  await updateFeeSchedule(env.DB, actor, fees);
  return successRedirect('/admin/familias', 'fees_updated');
});

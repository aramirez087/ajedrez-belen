import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cleanupExpiredDrafts } from '../../../../lib/portal/ocr';
import { successRedirect } from '../../../../lib/portal/http';
import { portalMutation } from '../../../../lib/portal/routes';

export const prerender = false;

export const POST: APIRoute = context => portalMutation(
  context, env, { admin: true, back: '/admin/comprobantes' }, async actor => {
    await cleanupExpiredDrafts(env.DB, actor, env.SLIPS, 20);
    return successRedirect('/admin/comprobantes', 'drafts_cleaned');
  },
);

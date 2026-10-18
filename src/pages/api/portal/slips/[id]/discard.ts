import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { discardEmailDraft } from '../../../../../lib/portal/ocr';
import { successRedirect } from '../../../../../lib/portal/http';
import { portalMutation } from '../../../../../lib/portal/routes';
import { PortalError } from '../../../../../lib/portal/types';

export const prerender = false;

export const POST: APIRoute = context => portalMutation(
  context, env, { back: '/portal' }, async actor => {
    try {
      await discardEmailDraft(env.DB, actor, env.SLIPS, context.params.id ?? '');
    } catch (error) {
      // Already gone (double click, a second tab, or it became part of a payment): say so, not an error.
      if (error instanceof PortalError && error.code === 'draft_not_found') return successRedirect('/portal', 'draft_gone');
      throw error;
    }
    return successRedirect('/portal', 'draft_discarded');
  },
);

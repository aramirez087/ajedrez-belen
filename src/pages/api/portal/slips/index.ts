import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { allowPortalDemo } from '../../../../lib/portal/demo-policy';
import { InputError, portalResponse, readSlip } from '../../../../lib/portal/http';
import { getOcrAvailability } from '../../../../lib/portal/ocr-policy';
import { portalMutation } from '../../../../lib/portal/routes';
import { saveSlipDraft } from '../../../../lib/portal/slip-upload';

export const prerender = false;

export const POST: APIRoute = context => portalMutation(
  context, env, { upload: true, back: '/portal/pagos/nuevo' }, async (actor, form) => {
    const slip = await readSlip(form);
    if (!slip) throw new InputError('invalid_file');
    const draft = await saveSlipDraft(env, actor, slip);
    return portalResponse(JSON.stringify({
      draft: { id: draft.id, type: draft.type, size: draft.size, sha256: draft.sha256, expiresAt: draft.expiresAt },
      ocr: getOcrAvailability(actor, env, { demoAllowed: allowPortalDemo(context.url, import.meta.env.DEV, env) }),
    }), 201, { 'Content-Type': 'application/json; charset=utf-8' });
  },
);

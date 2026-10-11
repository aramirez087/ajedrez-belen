import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { allowPortalDemo } from '../../../../../lib/portal/demo-policy';
import { requestSlipExtraction } from '../../../../../lib/portal/ocr';
import { InputError, portalResponse, readSlip } from '../../../../../lib/portal/http';
import { portalMutation } from '../../../../../lib/portal/routes';

export const prerender = false;

export const POST: APIRoute = context => portalMutation(
  context, env, { upload: true, back: '/portal/pagos/nuevo' }, async (actor, form) => {
    let derivedImage: { bytes: ArrayBuffer; contentType: 'image/png' | 'image/jpeg' } | undefined;
    const image = form.get('ocrImage');
    if (image instanceof File && image.size > 0) {
      const imageForm = new FormData();
      imageForm.set('slip', image);
      const parsed = await readSlip(imageForm);
      if (!parsed || !['image/png','image/jpeg'].includes(parsed.contentType) || parsed.size > 1_572_864) {
        throw new InputError('invalid_image');
      }
      derivedImage = { bytes: parsed.bytes, contentType: parsed.contentType as 'image/png' | 'image/jpeg' };
    } else if (image !== null && !(image instanceof File)) {
      throw new InputError('invalid_image');
    }
    const extraction = await requestSlipExtraction(env.DB, actor, context.params.id ?? '', env, {
      derivedImage,
      demoAllowed: allowPortalDemo(context.url, import.meta.env.DEV, env),
    });
    return portalResponse(JSON.stringify({ extraction }), 200, { 'Content-Type': 'application/json; charset=utf-8' });
  },
);

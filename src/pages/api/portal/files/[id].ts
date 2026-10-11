import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizePortal } from '../../../../lib/portal/access';
import { getPaymentFile } from '../../../../lib/portal/domain';
import { portalResponse } from '../../../../lib/portal/http';
export const prerender=false;
export const GET: APIRoute=async context=>{
  const access=await authorizePortal(context,env);
  if(!access.ok)return access.response;
  try {
    const file=await getPaymentFile(env.DB,access.actor,context.params.id!);
    const object=await env.SLIPS.get(file.key);
    if(!object)return portalResponse('Not found',404);
    const extension={'image/png':'png','image/jpeg':'jpg','application/pdf':'pdf'}[file.type]||'bin';
    const inline=context.url.searchParams.get('view')==='inline' && ['image/jpeg','image/png'].includes(file.type);
    return portalResponse(object.body,200,{
      'Content-Type':file.type,'Content-Length':String(object.size),
      'Content-Disposition':`${inline?'inline':'attachment'}; filename="comprobante-bancario.${extension}"`,
      'Content-Security-Policy':"default-src 'none'; sandbox; frame-ancestors 'none'",
    });
  } catch {return portalResponse('Not found',404);}
};

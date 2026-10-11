import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { allowPortalDemo, getDemoIdentity } from '../../../lib/portal/demo-policy';
import { seedDemo } from '../../../lib/portal/domain';
import { formText, mutationError, portalResponse, readPortalForm } from '../../../lib/portal/http';
export const prerender=false;
export const POST: APIRoute=async context=>{
  if (!allowPortalDemo(context.url,import.meta.env.DEV,env)) return portalResponse('Not found',404);
  try {
    const form = await readPortalForm(context.request);
    const role = formText(form,'role',20);
    const actor = getDemoIdentity(role);
    if (!actor) return portalResponse('Invalid role',400);
    const seeded=await env.DB.prepare('SELECT id FROM athletes WHERE id=?').bind('demo-athlete-3').first();
    if(!seeded)await seedDemo(env.DB);
    context.cookies.set('portal-demo-role',role,{httpOnly:true,sameSite:'strict',path:'/',maxAge:3600});
    return portalResponse(null,303,{Location:actor.isAdmin ? '/admin' : '/portal'});
  } catch(error) {return mutationError(context,error,'/demo');}
};

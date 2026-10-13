import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { setAthletePaused } from '../../../../../lib/portal/domain';
import { formText, successRedirect } from '../../../../../lib/portal/http';
import { portalMutation } from '../../../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{admin:true,back:'/admin/familias'},async(actor,form)=>{
  const action=formText(form,'action',10);
  if(action!=='pause'&&action!=='resume') return new Response('Invalid action',{status:400});
  await setAthletePaused(env.DB,actor,context.params.id!,action==='pause');
  return successRedirect('/admin/familias',action==='pause'?'athlete_paused':'athlete_resumed');
});

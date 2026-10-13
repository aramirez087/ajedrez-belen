import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { setOwnAthleteActive } from '../../../../lib/portal/domain';
import { formText, successRedirect } from '../../../../lib/portal/http';
import { portalMutation } from '../../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{back:'/portal/inscribir'},async(actor,form)=>{
  const action=formText(form,'action',12);
  if(action!=='deactivate'&&action!=='reactivate') return new Response('Invalid action',{status:400});
  await setOwnAthleteActive(env.DB,actor,context.params.id!,action==='reactivate');
  return successRedirect('/portal/inscribir',action==='reactivate'?'athlete_reactivated':'athlete_deactivated');
});

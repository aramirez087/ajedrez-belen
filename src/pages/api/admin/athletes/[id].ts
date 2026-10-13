import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { setAthleteFee } from '../../../../lib/portal/domain';
import { athleteFromForm } from '../../../../lib/portal/forms';
import { formText, successRedirect } from '../../../../lib/portal/http';
import { portalMutation } from '../../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{admin:true,back:'/admin/familias'},async(actor,form)=>{
  await setAthleteFee(env.DB,actor,context.params.id!,athleteFromForm(form),formText(form,'expectedSnapshot',2048));
  return successRedirect('/admin/familias','athlete_updated');
});

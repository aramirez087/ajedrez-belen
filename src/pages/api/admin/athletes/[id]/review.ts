import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { approveRegistration, rejectRegistration } from '../../../../../lib/portal/domain';
import { parseRegistrationReview, successRedirect } from '../../../../../lib/portal/http';
import { portalMutation } from '../../../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{admin:true,back:'/admin/inscripciones'},async(actor,form)=>{
  const review=parseRegistrationReview(form);
  if(review.action==='approve'){
    await approveRegistration(env.DB,actor,context.params.id!,{category:review.category});
    return successRedirect('/admin/inscripciones','registration_approved');
  }
  await rejectRegistration(env.DB,actor,context.params.id!,review.reason);
  return successRedirect('/admin/inscripciones','registration_rejected');
});

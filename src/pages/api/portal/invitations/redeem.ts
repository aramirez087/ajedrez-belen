import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { redeemInvitation } from '../../../../lib/portal/domain';
import { formText, successRedirect } from '../../../../lib/portal/http';
import { hashInvitationToken, portalMutation } from '../../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=async context=>portalMutation(context,env,{back:'/portal/invitacion'},async(actor,form)=>{
  const {kind}=await redeemInvitation(env.DB,actor,await hashInvitationToken(formText(form,'token',128)));
  context.cookies.delete('pending-invitation',{path:'/'});
  return kind==='register' ? successRedirect('/portal/inscribir','invitation_redeemed') : successRedirect('/portal','invitation_redeemed');
});

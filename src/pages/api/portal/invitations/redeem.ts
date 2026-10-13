import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { redeemInvitation } from '../../../../lib/portal/domain';
import { InputError, successRedirect } from '../../../../lib/portal/http';
import { hashInvitationToken, portalMutation } from '../../../../lib/portal/routes';
import { extractInvitationToken, invitationDestination } from '../../../../lib/portal/invitation-entry';
export const prerender=false;
export const POST: APIRoute=async context=>portalMutation(context,env,{back:'/portal/invitacion'},async(actor,form)=>{
  // Accept the code however the person pastes it: bare code, full link or message.
  const raw=form.get('token');
  const token=typeof raw==='string' ? extractInvitationToken(raw.slice(0,2000)) : null;
  if(!token) throw new InputError('invitation_invalid',400);
  try{
    const {kind}=await redeemInvitation(env.DB,actor,await hashInvitationToken(token));
    context.cookies.delete('pending-invitation',{path:'/'});
    return successRedirect(invitationDestination(kind),'invitation_redeemed');
  }catch(error){
    // A dead link must not loop forever behind an "Aceptar" button.
    if(error && typeof error==='object' && 'code' in error && error.code==='invitation_invalid'){
      context.cookies.delete('pending-invitation',{path:'/'});
    }
    throw error;
  }
});

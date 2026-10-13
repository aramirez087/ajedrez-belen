import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createGuardianInvitation } from '../../../../lib/portal/domain';
import { formText, InputError, successRedirect } from '../../../../lib/portal/http';
import { hashInvitationToken, portalMutation } from '../../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{back:'/portal/inscribir'},async(actor,form)=>{
  const athleteIds=form.getAll('athleteId[]');
  if(athleteIds.some(id=>typeof id!=='string'||id.length>80))throw new InputError('invalid_fields');
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  await createGuardianInvitation(env.DB,actor,{email:formText(form,'email',254).toLowerCase(),athleteIds:athleteIds as string[],tokenHash:await hashInvitationToken(token)});
  context.cookies.set('portal-invite-link',`${context.url.origin}/portal/invitacion?token=${token}`,{
    path:'/portal/inscribir',httpOnly:true,sameSite:'strict',secure:context.url.protocol==='https:',maxAge:300,
  });
  return successRedirect('/portal/inscribir','invitation_created');
});

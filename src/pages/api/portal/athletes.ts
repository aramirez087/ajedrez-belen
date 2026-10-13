import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createGuardianInvitation, registerAthletes, type SelfAthleteInput } from '../../../lib/portal/domain';
import { formText, InputError, successRedirect } from '../../../lib/portal/http';
import { formDate } from '../../../lib/portal/forms';
import { hashInvitationToken, portalMutation } from '../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{back:'/portal/inscribir'},async(actor,form)=>{
  const inputs: SelfAthleteInput[]=[];
  for(let i=0;i<6;i++){
    const name=form.get(`name-${i}`);
    if(name===null) continue;
    if(typeof name!=='string') throw new InputError('invalid_fields');
    if(!name.trim()) continue;
    inputs.push({
      name,
      birthDate:formDate(form,`birthDate-${i}`),
      nationalId:formText(form,`nationalId-${i}`,30,true) || undefined,
      school:formText(form,`school-${i}`,160),
      category:formText(form,`category-${i}`,40),
    });
  }
  const coGuardianEmail=formText(form,'coGuardianEmail',254,true).toLowerCase();
  if(coGuardianEmail && coGuardianEmail===actor.email.toLowerCase()) throw new InputError('invalid_fields');
  const athleteIds=await registerAthletes(env.DB,actor,inputs);
  if(coGuardianEmail){
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    await createGuardianInvitation(env.DB,actor,{email:coGuardianEmail,athleteIds,tokenHash:await hashInvitationToken(token)});
    context.cookies.set('portal-invite-link',`${context.url.origin}/portal/invitacion?token=${token}`,{
      path:'/portal/inscribir',httpOnly:true,sameSite:'strict',secure:context.url.protocol==='https:',maxAge:300,
    });
  }
  return successRedirect('/portal/inscribir','athletes_registered');
});

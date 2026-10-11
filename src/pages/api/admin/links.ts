import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { linkGuardian, revokeGuardian, setReceiptConsent } from '../../../lib/portal/domain';
import { formText, InputError, successRedirect } from '../../../lib/portal/http';
import { portalMutation } from '../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{admin:true,back:'/admin/familias'},async(actor,form)=>{
  const action=formText(form,'action',20);
  const input={userId:formText(form,'userId',80),athleteId:formText(form,'athleteId',80),receiptOptIn:form.get('receiptOptIn')==='on'};
  if(action==='link')await linkGuardian(env.DB,actor,input);
  else if(action==='revoke')await revokeGuardian(env.DB,actor,input);
  else if(action==='consent')await setReceiptConsent(env.DB,actor,input);
  else throw new InputError('invalid_fields');
  return successRedirect('/admin/familias','links_updated');
});

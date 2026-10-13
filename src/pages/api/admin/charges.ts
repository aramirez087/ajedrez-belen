import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { adjustCharge, publishMonth } from '../../../lib/portal/domain';
import { formText, InputError, parseMoney, successRedirect } from '../../../lib/portal/http';
import { portalMutation } from '../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{admin:true,back:'/admin/mensualidades'},async(actor,form)=>{
  const action=formText(form,'action',20);
  if(action==='publish') {
    const period=formText(form,'month',7);
    await publishMonth(env.DB,actor,period,formText(form,'expectedSnapshot',64));
    return successRedirect(`/admin/mensualidades?month=${encodeURIComponent(period)}`,'month_published');
  }
  if(action==='adjust') {
    const raw=formText(form,'adjustmentAmount',20);
    const negative=raw.startsWith('-');
    const amountMinor=parseMoney(negative?raw.slice(1):raw)*(negative?-1:1);
    await adjustCharge(env.DB,actor,{operationId:formText(form,'operationId',36),chargeId:formText(form,'chargeId',80),amountMinor,reason:formText(form,'reason',500)});
    return successRedirect('/admin/mensualidades','charge_adjusted');
  }
  throw new InputError('invalid_fields');
});

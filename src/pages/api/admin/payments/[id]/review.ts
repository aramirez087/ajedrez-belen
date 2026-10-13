import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { applyPaymentCredit, reviewPayment } from '../../../../../lib/portal/domain';
import { sendOutboxBatch } from '../../../../../lib/portal/email';
import { businessConfigurationUnavailable, formText, InputError, parseAllocations, parseMoney, successRedirect } from '../../../../../lib/portal/http';
import { resolveBusinessConfiguration } from '../../../../../lib/portal/business-config';
import { formDate } from '../../../../../lib/portal/forms';
import { portalMutation, readPaymentReviewSnapshot } from '../../../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{admin:true,back:`/admin/pagos/${context.params.id}`},async(actor,form)=>{
  const action=formText(form,'action',20),id=context.params.id!;
  const expected=readPaymentReviewSnapshot(form);
  if(action==='approve') {
    const business=resolveBusinessConfiguration(context.request,env);
    if(!business)return businessConfigurationUnavailable(context.request);
    if(form.get('bankChecked')!=='on')throw new InputError('bank_check_required');
    const {bankName,receivingAccount}=business;
    if(formText(form,'verifiedBankName',100)!==bankName||formText(form,'verifiedReceivingAccount',100)!==receivingAccount)throw new InputError('invalid_fields');
    const receiptId=await reviewPayment(env.DB,actor,id,{
      ...expected,action:'verify',bankChecked:true,currency:'CRC',
      associationName:business.associationName,
      bankName,receivingAccount,
      bankReference:formText(form,'verifiedReference',128),amountMinor:parseMoney(form.get('verifiedAmount')),
      paymentDate:formDate(form,'verifiedDate'),allocations:parseAllocations(form),
      note:formText(form,'reason',500,true)||undefined,
    });
    try {if(receiptId)await sendOutboxBatch(env.DB,actor,env,{receiptId});}
    catch {return successRedirect(`/admin/pagos/${id}`,'verified_email_pending');}
    return successRedirect(`/admin/pagos/${id}`,'verified');
  }
  if(action==='apply_credit') {
    await applyPaymentCredit(env.DB,actor,{operationId:formText(form,'operationId',36),paymentId:id,allocations:parseAllocations(form),reason:formText(form,'reason',500)});
    return successRedirect(`/admin/pagos/${id}`,'credit_applied');
  }
  if(!['needs_info','reject','void'].includes(action))throw new InputError('invalid_fields');
  const receiptId=await reviewPayment(env.DB,actor,id,{...expected,action:action as 'needs_info'|'reject'|'void',reason:formText(form,'reason',500)});
  if(action==='void'&&receiptId){try{await sendOutboxBatch(env.DB,actor,env,{receiptId});}catch{/* Persisted notice remains queued. */}}
  return successRedirect(`/admin/pagos/${id}`,action);
});

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { prepareReceiptEmail, retryEmailOutbox, sendOutboxBatch } from '../../../lib/portal/email';
import { formText, InputError, successRedirect } from '../../../lib/portal/http';
import { portalMutation } from '../../../lib/portal/routes';
export const prerender=false;
export const POST: APIRoute=context=>portalMutation(context,env,{admin:true,back:'/admin/comprobantes'},async(actor,form)=>{
  const action=formText(form,'action',20);
  if(action==='prepare') {
    await prepareReceiptEmail(env.DB,actor,formText(form,'receiptId',80));
    return successRedirect('/admin/comprobantes','email_prepared');
  }
  if(action==='retry') {
    if(!await retryEmailOutbox(env.DB,actor,formText(form,'outboxId',80)))throw new InputError('not_retryable',409);
    return successRedirect('/admin/comprobantes','email_queued');
  }
  if(action==='send_batch') {
    const batch=await sendOutboxBatch(env.DB,actor,env);
    // Batches are capped at five: say plainly when more mail is still queued
    // so an admin never reads a partial run as "everything sent".
    const notice=batch.remaining>0?'email_processed_remaining'
      :batch.processed===0?'email_none'
      :env.EMAIL_MODE==='live'?'email_processed':'dry_run';
    return successRedirect('/admin/comprobantes',notice);
  }
  throw new InputError('invalid_fields');
});

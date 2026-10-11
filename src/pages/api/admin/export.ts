import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizePortal } from '../../../lib/portal/access';
import { portalResponse } from '../../../lib/portal/http';
export const prerender=false;

const exports = {
  charges:{sql:`SELECT c.id,a.name AS athlete,c.period,c.due_date,c.base_minor,c.discount_minor,
    c.discount_reason,coalesce((SELECT sum(amount_minor) FROM charge_adjustments WHERE charge_id=c.id),0) AS adjustments_minor,
    coalesce((SELECT sum(pa.amount_minor) FROM payment_allocations pa JOIN payments p ON p.id=pa.payment_id WHERE pa.charge_id=c.id AND p.status='verified'),0) AS paid_minor
    FROM charges c JOIN athletes a ON a.id=c.athlete_id ORDER BY c.period,a.name`,
    columns:['id','athlete','period','due_date','base_minor','discount_minor','discount_reason','adjustments_minor','paid_minor']},
  payments:{sql:`SELECT p.id,u.name AS designated_adult,p.payer_name,p.amount_minor,p.transfer_date,p.bank_reference,p.status,
    p.verified_amount_minor,p.verified_reference,p.verified_date,p.verified_bank_name,p.verified_receiving_account,p.review_note,p.submitted_at,p.verified_at
    FROM payments p JOIN users u ON u.id=p.designated_user_id ORDER BY p.submitted_at`,
    columns:['id','designated_adult','payer_name','amount_minor','transfer_date','bank_reference','status','verified_amount_minor','verified_reference','verified_date','verified_bank_name','verified_receiving_account','review_note','submitted_at','verified_at']},
  receipts:{sql:'SELECT id,payment_id,number,status,snapshot_json,void_reason,voided_at,created_at FROM receipts ORDER BY year,sequence',
    columns:['id','payment_id','number','status','snapshot_json','void_reason','voided_at','created_at']},
  audit:{sql:'SELECT id,actor_id,entity_type,entity_id,action,detail_json,created_at FROM audit_events ORDER BY created_at',
    columns:['id','actor_id','entity_type','entity_id','action','detail_json','created_at']},
  email:{sql:'SELECT id,receipt_id,recipient_id,recipient_email,kind,status,attempts,next_attempt_at,last_error_code,provider_message_id,created_at,updated_at FROM email_outbox ORDER BY created_at',
    columns:['id','receipt_id','recipient_id','recipient_email','kind','status','attempts','next_attempt_at','last_error_code','provider_message_id','created_at','updated_at']},
};
function csvCell(value: unknown, forceText=false): string {
  let text=value===null||value===undefined?'':String(value);
  // Text from uploads/profile fields must never become a spreadsheet formula.
  if(typeof value==='string'&&(forceText||/^[\s]*[=+@-]/.test(text)))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export const GET: APIRoute=async context=>{
  const access=await authorizePortal(context,env,{admin:true});
  if(!access.ok)return access.response;
  const kind=context.url.searchParams.get('kind')||'payments';
  if(!Object.hasOwn(exports,kind))return portalResponse('Invalid export',400);
  const definition=exports[kind as keyof typeof exports];
  const result=await env.DB.prepare(definition.sql).all<Record<string,unknown>>();
  if(context.url.searchParams.get('format')==='json')return portalResponse(JSON.stringify(result.results),200,{
    'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="ajedrez-${kind}.json"`,
  });
  const csv=[definition.columns.map(column=>csvCell(column)).join(','),...result.results.map(row=>definition.columns.map(column=>csvCell(row[column],['bank_reference','verified_reference'].includes(column))).join(','))].join('\r\n');
  return portalResponse('\uFEFF'+csv,200,{
    'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="ajedrez-${kind}.csv"`,
  });
};

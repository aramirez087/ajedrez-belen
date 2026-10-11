import { formText, parseMoney } from './http';
import type { AthleteInput } from './types';
export function athleteFromForm(form: FormData): AthleteInput {
  return {
    name:formText(form,'name'),category:formText(form,'category',80),
    feeMinor:parseMoney(form.get('monthlyFee')),discountMinor:parseMoney(form.get('manualDiscount')??'0',true),
    discountReason:formText(form,'discountReason',500,true)||undefined,
    active:form.get('active')==='on',startPeriod:formText(form,'startPeriod',7),
  };
}

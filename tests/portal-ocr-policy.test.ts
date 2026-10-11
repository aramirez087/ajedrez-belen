import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOcrAvailability } from '../src/lib/portal/ocr-policy';
import type { Actor } from '../src/lib/portal/types';

const actor: Actor = { id:'synthetic', email:'synthetic@example.invalid', name:'Demo', isAdmin:false, mode:'demo' };

test('OCR defaults off and an invalid configuration cannot enable a provider', () => {
  for (const OCR_MODE of [undefined, '', 'live', 'invalid']) {
    assert.deepEqual(getOcrAvailability(actor,{OCR_MODE},{demoAllowed:true}), {mode:'off',available:false});
  }
});

test('synthetic OCR requires a synthetic actor and trusted local development guard', () => {
  assert.equal(getOcrAvailability(actor,{OCR_MODE:'demo'},{demoAllowed:true}).available,true);
  assert.equal(getOcrAvailability(actor,{OCR_MODE:'demo'},{demoAllowed:false}).available,false);
  assert.equal(getOcrAvailability({...actor,mode:'workos'},{OCR_MODE:'demo'},{demoAllowed:true}).available,false);
});

test('a configured Groq key never authorizes a demo identity for real OCR', () => {
  const env={OCR_MODE:'groq',GROQ_API_KEY:'synthetic-provider-key'};
  assert.equal(getOcrAvailability(actor,env,{demoAllowed:true}).available,false);
  assert.equal(getOcrAvailability({...actor,mode:'workos'},env,{demoAllowed:false}).available,true);
  assert.equal(getOcrAvailability({...actor,mode:'workos'},{OCR_MODE:'groq'},{demoAllowed:false}).available,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { allowPortalDemo, getDemoIdentity } from '../src/lib/portal/demo-policy.ts';
import { parseAllocations, parseMoney } from '../src/lib/portal/http.ts';
import { getPortalIdentity } from '../src/lib/portal/access.ts';

test('demo identities cannot authorize a production build or a remote development host',()=>{
  const flags={PORTAL_ENABLED:'true',PORTAL_DEMO:'true'};
  assert.equal(allowPortalDemo(new URL('http://127.0.0.1:4322'),false,flags),false);
  assert.equal(allowPortalDemo(new URL('https://payments.example'),true,flags),false);
  assert.equal(allowPortalDemo(new URL('http://127.0.0.1:4322'),true,flags),true);
  assert.equal(getDemoIdentity('user-chosen-admin'),null);
});

test('payment allocations retain exact cents and reject mismatched or duplicated charge fields',()=>{
  assert.equal(parseMoney('0.29'),29);
  assert.equal(parseMoney('12000.00'),1200000);
  for(const value of ['-1','1e3','0.0012','NaN','0'])assert.throws(()=>parseMoney(value));
  const form=new FormData();
  form.append('allocationChargeId[]','charge-a');form.append('allocationAmount[]','0.29');
  assert.deepEqual(parseAllocations(form),[{chargeId:'charge-a',amountMinor:29}]);
  form.append('allocationChargeId[]','charge-a');form.append('allocationAmount[]','100');
  assert.throws(()=>parseAllocations(form));
});

test('parent identity needs verified email; admin needs both staff organization and immutable allowlisted id',()=>{
  const env={WORKOS_API_KEY:'fixture',WORKOS_CLIENT_ID:'client',WORKOS_COOKIE_PASSWORD:'x'.repeat(32),
    WORKOS_REDIRECT_URI:'http://127.0.0.1:4322/auth/callback',WORKOS_ORGANIZATION_ID:'org_staff',ADMIN_USER_IDS:'user_staff'} as Cloudflare.Env;
  const context={locals:{auth:{user:{id:'user_staff',email:'staff@example.invalid',emailVerified:true,firstName:'Staff',lastName:null},
    accessToken:'SDK_VERIFIED_FIXTURE',sessionId:'session',organizationId:undefined}}} as Parameters<typeof getPortalIdentity>[0];
  assert.equal(getPortalIdentity(context,env)?.isAdmin,false);
  const auth=context.locals.auth;
  if(!auth?.user)throw new Error('Missing auth fixture');
  auth.organizationId='org_staff';
  assert.equal(getPortalIdentity(context,env)?.isAdmin,true);
  auth.user.emailVerified=false;
  assert.equal(getPortalIdentity(context,env),null);
  auth.user.emailVerified=true;
  auth.impersonator={email:'operator@example.invalid',reason:'fixture'};
  assert.equal(getPortalIdentity(context,env),null);
});

test('unused allocations accept decimal zero without weakening money validation',()=>{
  const form=new FormData();
  for(const [index,value] of ['', '0', '0.0', '0.00', '00.00'].entries()) {
    form.append('allocationChargeId[]',`unused-${index}`);
    form.append('allocationAmount[]',value);
  }
  form.append('allocationChargeId[]','paid');form.append('allocationAmount[]','1000.29');
  assert.deepEqual(parseAllocations(form),[{chargeId:'paid',amountMinor:100029}]);
  for(const value of ['0e0','-0']) {
    const invalid=new FormData();
    invalid.append('allocationChargeId[]','unused');invalid.append('allocationAmount[]',value);
    assert.throws(()=>parseAllocations(invalid));
  }
});

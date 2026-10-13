import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIContext } from 'astro';
import type { getAuthService } from '../src/lib/workos-runtime.ts';
import { stagingCallback, stagingSetup, stagingSignIn, stagingSignOut } from '../src/lib/staging-auth.ts';

type Service = NonNullable<ReturnType<typeof getAuthService>>;
const blockedBinding = new Proxy({}, { get() { throw new Error('Business binding must never be touched'); } });
const env = {
  STAGING_AUTH_SETUP:'true', PORTAL_ENABLED:'false', PORTAL_DEMO:'false',
  PROTOTYPE_ENABLED:'false', PROTOTYPE_LOCAL:'false', EMAIL_MODE:'dry_run', OCR_MODE:'off',
  WORKOS_API_KEY:'sk_fixture', WORKOS_CLIENT_ID:'client_fixture',
  WORKOS_COOKIE_PASSWORD:'synthetic-cookie-secret-not-for-live-use-123456',
  WORKOS_REDIRECT_URI:'https://example.test/auth/callback', WORKOS_ORGANIZATION_ID:'org_fixture',
  ADMIN_USER_IDS:'user_fixture', DB:blockedBinding, SLIPS:blockedBinding,
} as unknown as Cloudflare.Env;
const owner = {
  user:{id:'user_fixture',email:'synthetic@example.test',emailVerified:true},
  sessionId:'session_fixture',accessToken:'verified-sdk-fixture',organizationId:'org_fixture',impersonator:null,
};
function context(path='/auth/setup', auth:unknown=owner) {
  return {
    cookies:{}, locals:{auth}, url:new URL(path,'https://example.test'),
    redirect:(location:string,status=302)=>new Response(null,{status,headers:{Location:location}}),
  } as unknown as APIContext;
}
function fixture(auth:unknown=owner) {
  const calls:{name:string;args:unknown[]}[]=[];
  const method=(name:string,result:unknown)=>async (...args:unknown[])=>{calls.push({name,args});return result;};
  const service={
    clearSession:method('clearSession',{}),
    clearPendingVerifier:method('clearPendingVerifier',{}),
    createSignIn:method('createSignIn',{url:'https://api.workos.com/user_management/authorize'}),
    handleCallback:method('handleCallback',{returnPathname:'https://attacker.test/private',authResponse:{user:owner.user}}),
    withAuth:method('withAuth',{auth}), saveSession:method('saveSession',{}),
    signOut:method('signOut',{logoutUrl:'https://api.workos.com/user_management/sessions/logout',headers:{'Set-Cookie':'wos-session=; Max-Age=0; Path=/'}}),
  } as unknown as Service;
  return {service,calls};
}

test('staging login ignores caller destinations and fixes organization/setup return path', async()=>{
  const {service,calls}=fixture();
  const response=await stagingSignIn(context('/auth/admin?returnTo=https://attacker.test&organization_id=org_other'),env,service);
  assert.equal(response.status,302);
  assert.equal(calls[0].name,'clearSession');
  assert.deepEqual(calls.find(call=>call.name==='createSignIn')?.args[1],{
    organizationId:'org_fixture',returnPathname:'/auth/setup',
  });
});

test('verified owner callback checks the new SDK session and ignores unsafe or stale return paths',async()=>{
  const {service,calls}=fixture();
  const response=await stagingCallback(context('/auth/callback?code=synthetic&state=synthetic'),env,service);
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'/auth/setup');
  assert.deepEqual(calls.map(call=>call.name),['handleCallback','withAuth']);
});

test('callback rejects nonowner, wrong-org, unverified, impersonated and missing sessions before granting a result',async()=>{
  for(const auth of [
    {...owner,user:{...owner.user,id:'user_other'}},
    {...owner,organizationId:'org_other'},
    {...owner,user:{...owner.user,emailVerified:false}},
    {...owner,impersonator:{email:'operator@example.test'}},
    {...owner,sessionId:undefined}, {user:null},
  ]) {
    const {service,calls}=fixture(auth);
    const response=await stagingCallback(context('/auth/callback?code=synthetic&state=synthetic'),env,service);
    assert.equal(response.status,403);
    assert.equal(response.headers.has('location'),false);
    assert.equal(calls.at(-1)?.name,'clearSession');
    assert.equal(calls.some(call=>call.name==='saveSession'),false);
  }
});

test('failed callbacks clear session and never expose provider details or exchange absent/error codes',async()=>{
  for(const path of ['/auth/callback','/auth/callback?error=PRIVATE_PROVIDER_DETAIL&code=unused&state=synthetic']) {
    const {service,calls}=fixture();
    const response=await stagingCallback(context(path),env,service);
    assert.equal(response.status,400);
    const body = await response.text();
    assert.match(body,/href="\/auth\/admin" referrerpolicy="no-referrer"/);
    assert.doesNotMatch(body,/href="\/auth\/parent"/);
    assert.equal(calls.some(call=>call.name==='handleCallback'),false);
    assert.equal(calls.at(-1)?.name,'clearSession');
  }
  const {service,calls}=fixture();
  service.handleCallback=async()=>{throw new Error('PRIVATE_PROVIDER_DETAIL');};
  const response=await stagingCallback(context('/auth/callback?code=synthetic&state=bad'),env,service);
  assert.equal(response.status,400);
  assert.doesNotMatch(await response.text(),/PRIVATE_PROVIDER_DETAIL|synthetic|stack/);
  assert.equal(calls.at(-1)?.name,'clearSession');
});

test('confirmation is static and never reads business bindings or exposes identity/config/session data',async(t)=>{
  const network=t.mock.method(globalThis,'fetch',async()=>{throw new Error('No provider requests from confirmation');});
  for(const auth of [owner,{user:null}]) {
    const {service,calls}=fixture(auth);
    const response=await stagingSetup(context('/auth/setup?returnTo=https://attacker.test',auth),env,service);
    assert.equal(response.status,200);
    const body=await response.text();
    for(const hidden of [owner.user.email,owner.user.id,owner.accessToken,owner.sessionId,env.WORKOS_API_KEY!,env.WORKOS_COOKIE_PASSWORD!,env.WORKOS_ORGANIZATION_ID!]) assert.equal(body.includes(hidden),false);
    assert.doesNotMatch(body,/<script\b|https?:\/\//i);
    assert.deepEqual(calls.map(call=>call.name),auth.user ? [] : ['clearSession']);
  }
  const invalid={...owner,organizationId:'org_wrong'};
  const {service,calls}=fixture(invalid);
  assert.equal((await stagingSetup(context('/auth/setup',invalid),env,service)).status,403);
  assert.equal(calls.at(-1)?.name,'clearSession');
  assert.equal(network.mock.callCount(),0);
});

test('logout clears anonymous or denied sessions and fixes verified owner logout return origin',async()=>{
  for(const auth of [{user:null},{...owner,user:{...owner.user,id:'user_other'}}]) {
    const {service,calls}=fixture(auth);
    const response=await stagingSignOut(context('/auth/logout?returnTo=https://attacker.test',auth),env,service);
    assert.equal(response.status,auth.user ? 403 : 303);
    assert.equal(calls.some(call=>call.name==='signOut'),false);
    assert.equal(calls.at(-1)?.name,'clearSession');
  }
  const {service,calls}=fixture();
  const response=await stagingSignOut(context('/auth/logout?returnTo=https://attacker.test'),env,service);
  assert.equal(response.status,303);
  assert.deepEqual(calls.map(call=>call.name),['clearSession','signOut']);
  assert.deepEqual(calls[1].args,['session_fixture',{returnTo:'https://example.test/'}]);
  assert.match(response.headers.get('set-cookie')??'',/Max-Age=0/);
});

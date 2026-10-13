import assert from 'node:assert/strict';
import test from 'node:test';
import type { APIContext } from 'astro';
import { authorizePortal } from '../src/lib/portal/access.ts';
import { stagingAuthSetupPage } from '../src/lib/staging-auth-view.ts';

const environment = {
  STAGING_AUTH_SETUP:'true', STAGING_PORTAL_TEST:'true', PORTAL_ENABLED:'true',
  PORTAL_DEMO:'false', PROTOTYPE_ENABLED:'false', PROTOTYPE_LOCAL:'false',
  EMAIL_MODE:'dry_run', OCR_MODE:'off', WORKOS_API_KEY:'sk_fixture',
  WORKOS_CLIENT_ID:'client_fixture', WORKOS_COOKIE_PASSWORD:'synthetic-cookie-secret-for-local-tests-only',
  WORKOS_REDIRECT_URI:'https://example.test/auth/callback', WORKOS_ORGANIZATION_ID:'org_fixture',
  ADMIN_USER_IDS:'user_fixture',
};
const owner = {
  user:{id:'user_fixture',email:'owner@example.invalid',emailVerified:true,firstName:'Synthetic',lastName:'Owner'},
  sessionId:'session_fixture', accessToken:'sdk-validated-fixture', organizationId:'org_fixture', impersonator:null,
};
function context(auth:unknown=owner) {
  return {locals:{auth},url:new URL('https://example.test/admin'),request:new Request('https://example.test/admin')} as APIContext;
}
function database(active=1) {
  const sql:string[]=[];
  const db={prepare(query:string){sql.push(query);return {bind(){return {
    async run(){return {success:true};},async first(){return {id:'user_fixture',active};},
  };}};}};
  return {db,sql};
}

test('restricted portal defense rejects every other identity before touching any business binding',async()=>{
  const forbidden = new Proxy({}, {get(){assert.fail('Rejected identity touched a data binding');}});
  for(const auth of [
    {user:null}, {...owner,user:{...owner.user,id:'user_other'}}, {...owner,organizationId:'org_other'},
    {...owner,organizationId:undefined}, {...owner,user:{...owner.user,emailVerified:false}},
    {...owner,impersonator:{email:'support@example.invalid'}}, {...owner,sessionId:''},
  ]) {
    const result=await authorizePortal(context(auth),{...environment,DB:forbidden,SLIPS:forbidden} as unknown as Cloudflare.Env,{admin:true});
    assert.equal(result.ok,false);
    if(!result.ok)assert.equal(result.response.status,403);
  }
});

test('malformed or unsafe staging flags cannot authorize a data write even for the owner',async()=>{
  const forbidden = new Proxy({}, {get(){assert.fail('Invalid configuration touched a data binding');}});
  for(const change of [
    {STAGING_AUTH_SETUP:'false'},{STAGING_AUTH_SETUP:undefined},{STAGING_PORTAL_TEST:'false'},
    {STAGING_PORTAL_TEST:'yes'},{EMAIL_MODE:'live'},{OCR_MODE:'groq'},{PORTAL_DEMO:'true'},
    {ADMIN_USER_IDS:'user_fixture,user_other'},
  ]) {
    const result=await authorizePortal(context(),{...environment,...change,DB:forbidden,SLIPS:forbidden} as unknown as Cloudflare.Env);
    assert.equal(result.ok,false);
    if(!result.ok)assert.equal(result.response.status,403);
  }
});

test('sole owner keeps the existing administrator checks and active-account enforcement',async()=>{
  for(const active of [0,1]) {
    const {db,sql}=database(active);
    const result=await authorizePortal(context(),{...environment,DB:db} as unknown as Cloudflare.Env,{admin:true});
    assert.equal(result.ok,active===1);
    assert.equal(sql.length,2,'Existing account upsert and active-account lookup remain required');
    if(result.ok){assert.equal(result.actor.id,owner.user.id);assert.equal(result.actor.isAdmin,true);assert.equal(result.actor.mode,'workos');}
    else assert.equal(result.response.status,403);
  }
});

test('fictional test entry is shown only after owner verification; auth-only copy stays accurate',async()=>{
  const testPage=await stagingAuthSetupPage(true,true).text();
  assert.match(testPage,/href="\/admin"/);assert.match(testPage,/datos ficticios/);assert.match(testPage,/correos se simulan/);
  assert.doesNotMatch(await stagingAuthSetupPage(false,true).text(),/href="\/admin"/);
  const authOnly=await stagingAuthSetupPage(true,false).text();
  assert.match(authOnly,/continúa deshabilitado/);assert.doesNotMatch(authOnly,/href="\/admin"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase} from '../server/db.js';
import {createAccount} from '../server/auth.js';
import {createApp} from '../server/app.js';
import {demoAccountNames} from '../server/demo.js';
const password='Demo-isolation-test-password9!';
async function setup(t){const store=createDatabase(':memory:');await createAccount(store,{username:'demo_test_admin',password,role:'admin'});await createAccount(store,{username:'demo_real_buyer',password,role:'buyer'});const server=createApp(store,{secureCookies:false}).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close()});const root='http://127.0.0.1:'+server.address().port+'/api';
 const req=async(path,body,cookie='',method=body?'POST':'GET',headers={})=>{const r=await fetch(root+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers}};
 const login=async username=>{const r=await req('/auth/login',{username,password});assert.equal(r.status,200);return r.cookie};return {store,req,login};}

test('two read-only demo accounts have explicitly fictional examples and one-hour sessions',async t=>{
 const {store,req}=await setup(t);const first=await req('/auth/demo',{role:'buyer'});assert.equal(first.status,200);assert.equal(first.body.user.isDemo,true);assert.equal(first.body.user.role,'buyer');assert.equal(first.body.user.username,demoAccountNames.buyer);assert.ok(!('passwordHash' in first.body.user));
 const session=(await store.all('sessions')).find(x=>x.isDemo);assert.ok(session.expiresAt<=Date.now()+3600000&&session.expiresAt>Date.now()+3500000);
 const boot=await req('/bootstrap',null,first.cookie);assert.equal(boot.body.demo.readOnly,true);assert.equal(boot.body.products.filter(x=>x.catalogOnly).length,48);assert.equal(boot.body.orders.length,1);assert.ok(boot.body.orders[0].buyer.includes('【演示】'));assert.equal(boot.body.suppliers[0].verified,false);assert.equal(boot.body.orders[0].email,'demo@example.invalid');
 const risk=await req('/risk',null,first.cookie);assert.equal(risk.status,200);assert.equal(risk.body.demo,true);const profiles=risk.body.records.filter(x=>x.kind==='profile');assert.equal(profiles.length,3);assert.ok(profiles.every(p=>p.source==='example'&&p.registration===null&&p.financialEvidence===null));assert.equal(risk.body.records.filter(x=>['credit','ledger','approval'].includes(x.kind)).length,0);assert.equal(risk.body.records.filter(x=>x.kind==='demo_case').length,1);assert.ok(risk.body.assessments.some(e=>e.missing.includes('数量')&&e.stressedMarginMinor===null));assert.ok(risk.body.assessments.every(e=>e.status==='资料待补齐'));
 const second=await req('/auth/demo',{role:'supplier'});assert.equal(second.body.user.role,'supplier');assert.notEqual(second.body.user.id,first.body.user.id);
 const supplier=(await req('/risk',null,second.cookie)).body;assert.ok(supplier.records.every(x=>x.ownerId===second.body.user.id));assert.ok(!JSON.stringify(supplier).includes('demo:buyer:'));
 const hidden=store.all('products').find(p=>p.catalogOnly&&!p.isSample);store.put('products',{...hidden,status:'已下架'});const filtered=(await req('/bootstrap',null,first.cookie)).body;assert.ok(!filtered.products.some(p=>p.id===hidden.id));
});

test('demo accounts cannot mutate business or risk data, import, approve or export the real database',async t=>{
 const {store,req}=await setup(t),demo=await req('/auth/demo',{role:'buyer'});const cookie=demo.cookie;
 const before=await store.all('risk_records'),audit=await store.all('risk_audit');
 const attacks=[['/products',{}],['/orders',{}],['/applications',{}],['/inquiries',{}],['/profit',{}],['/risk/profiles',{}],['/risk/trades',{}],['/risk/import',{}],['/risk/approvals/credit',{}],['/risk/approvals/reserve',{}],['/risk/approvals/receipt',{}],['/risk/approvals/release',{}],['/risk/alerts/scan',{}],['/risk/approvals/anything/decide',{}],['/risk/rules',{},'PUT'],['/risk/tickets/anything',{},'PATCH'],['/risk/profiles/anything',{},'PATCH']];
 for(const [path,body,method] of attacks){const r=await req(path,body,cookie,method||'POST');assert.equal(r.status,403,path);assert.match(r.body.error,/只读/)}
 for(const path of ['/admin/backup','/risk/audit/verify'])assert.equal((await req(path,null,cookie)).status,403);
 assert.deepEqual(await store.all('risk_records'),before);assert.deepEqual(await store.all('risk_audit'),audit);
 const logout=await req('/auth/logout',{},cookie);assert.equal(logout.status,200);assert.equal((await req('/risk',null,cookie)).status,401);
});

test('real users and administrators do not receive demo records or statistics; audit remains intact',async t=>{
 const {req,login}=await setup(t);await req('/auth/demo',{role:'buyer'});await req('/auth/demo',{role:'supplier'});
 for(const cookie of ['',await login('demo_real_buyer'),await login('demo_test_admin')]){
  const boot=(await req('/bootstrap',null,cookie)).body;assert.equal(boot.products.length,48);assert.equal(boot.orders.length,0);assert.equal(boot.inquiries.length,0);assert.equal(boot.suppliers.length,0);assert.ok(!('demo' in boot));
  if(cookie){const risk=(await req('/risk',null,cookie)).body;assert.equal(risk.records.length,0);assert.equal(risk.audit.length,0)}
 }
 const admin=await login('demo_test_admin');assert.equal((await req('/risk/audit/verify',null,admin)).body.ok,true);
 assert.equal((await req('/risk/profiles/demo:buyer:customer-a',{version:1,reason:'Must not alter demo'},admin,'PATCH')).status,404);
 const backup=(await req('/admin/backup',null,admin)).body;assert.equal(backup.tables.risk_audit.length,2);assert.ok(backup.tables.risk_audit.every(x=>x.isDemo));
});

test('demo provisioning is idempotent under concurrency and cannot overwrite an existing account',async t=>{
 const {store,req,login}=await setup(t);
 const results=await Promise.all([req('/auth/demo',{role:'buyer'}),req('/auth/demo',{role:'buyer'})]);assert.ok(results.every(x=>x.status===200));assert.equal(results[0].body.user.id,results[1].body.user.id);assert.equal((await store.all('risk_audit')).length,1);
 const admin=await login('demo_test_admin');assert.equal((await req('/auth/demo',{role:'supplier'},admin)).status,409);assert.equal((await req('/auth/me',null,admin)).body.user.role,'admin');
 // Preserve a pre-existing normal account at the other reserved name.
 store.insert('users',{id:demoAccountNames.supplier,username:demoAccountNames.supplier,displayName:'Pre-existing account',role:'buyer',passwordHash:'opaque-existing-hash'});
 const collision=await req('/auth/demo',{role:'supplier'});assert.equal(collision.status,409);assert.equal(store.get('users',demoAccountNames.supplier).displayName,'Pre-existing account');
});

test('demo authentication has CSRF, role, expiry and rate-limit protections and cannot register a privileged demo',async t=>{
 const {store,req}=await setup(t);
 assert.equal((await req('/auth/demo',{role:'admin'})).status,400);assert.equal((await req('/auth/demo',{role:{}})).status,400);assert.equal((await req('/auth/demo',{role:'buyer'},'','POST',{Origin:'https://untrusted.invalid'})).status,403);
 const denied=await req('/auth/register',{username:demoAccountNames.buyer,password,isDemo:true});assert.equal(denied.status,400);
 const demo=await req('/auth/demo',{role:'buyer'});const session=(await store.all('sessions')).find(s=>s.isDemo);store.put('sessions',{...session,expiresAt:Date.now()-1});assert.equal((await req('/risk',null,demo.cookie)).status,401);
 // A new session remains functional; a normal registration never accepts isDemo or admin role.
 const again=await req('/auth/demo',{role:'buyer'});assert.equal(again.status,200);const normal=await req('/auth/register',{username:'not_a_demo',password,isDemo:true},again.cookie);assert.equal(normal.status,201);assert.ok(!normal.body.user.isDemo);
 for(let i=0;i<30;i++)await req('/auth/demo',{role:'admin'});assert.equal((await req('/auth/demo',{role:'buyer'})).status,429);
});

test('public demo uses independent example rules and never reveals real policy audit reasons',async t=>{
 const {req,login}=await setup(t),admin=await login('demo_test_admin');
 const r=(await req('/risk',null,admin)).body.rules;const changed=await req('/risk/rules',{...r,steelShockPct:8,reason:'Confidential internal rule reasoning'},admin,'PUT');assert.equal(changed.status,200);
 const demo=await req('/auth/demo',{role:'buyer'});const risk=(await req('/risk',null,demo.cookie)).body;assert.equal(risk.rules.steelShockPct,5);assert.equal(risk.rules.demoScenario,true);assert.ok(risk.audit.every(a=>a.isDemo&&a.ownerId===demo.body.user.id));assert.ok(!JSON.stringify(risk).includes('Confidential internal'));assert.ok(risk.assessments.every(e=>e.rulesSnapshot.steelShockPct===5));
 assert.equal((await req('/risk',null,admin)).body.rules.steelShockPct,8);
});

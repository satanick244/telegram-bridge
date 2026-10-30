import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase} from '../server/db.js';
import {createAccount} from '../server/auth.js';
import {createApp} from '../server/app.js';
import {evaluate,parseRows,minor} from '../server/risk-domain.js';
import {defaultRiskRules} from '../server/risk-schema.js';
const password='Risk-local-test-password9!';
async function setup(t){
 const store=createDatabase(':memory:');for(const [username,role] of [['risk_admin','admin'],['risk_a','buyer'],['risk_b','supplier']])await createAccount(store,{username,password,role});
 const server=createApp(store,{secureCookies:false}).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await store.close()});
 const root='http://127.0.0.1:'+server.address().port+'/api';const cookies={};
 for(const name of ['risk_admin','risk_a','risk_b']){const r=await fetch(root+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password})});assert.equal(r.status,200);cookies[name]=(r.headers.get('set-cookie')||'').split(';')[0]}
 const req=async(path,body,user='risk_a',method=body?'POST':'GET')=>{const r=await fetch(root+'/risk'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookies[user]||''},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 const ok=async(path,body,user='risk_a',method)=>{const r=await req(path,body,user,method);assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.body};
 return {store,req,ok};
}
const profile=(overrides={})=>({businessKey:'customer-1',name:'Explicit test customer',partyType:'customer',country:'中国',registration:'Test registration evidence',financialEvidence:'Test financial statement index',performanceEvidence:'Test performance index',source:'manual',sourceNote:'Test fixture, never production',...overrides});
const trade=(profileId,overrides={})=>({profileId,businessKey:'contract-1',direction:'sale',amount:'1000.00',currency:'USD',quantity:'10',unit:'吨',term:'FOB',paymentMode:'credit',dueDate:'2020-01-01',steelUnitCost:'100',steelCurrency:'CNY',steelCostUnit:'吨',freight:'100',freightCurrency:'CNY',freightPayer:'self',freightIncluded:true,fxRate:'7',source:'manual',sourceNote:'Explicit fixture contract',...overrides});
async function grant(ok,p,amount='1500',overrides={}){const a=await ok('/approvals/credit',{profileId:p.id,currency:'USD',amount,businessKey:'grant-'+amount,reason:'Reviewed financial test fixture',...overrides});return ok('/approvals/'+a.id+'/decide',{decision:'approved',reason:'Manual credit approval for test only'},'risk_admin')}
async function reserve(ok,t,businessKey='reserve-1'){const a=await ok('/approvals/reserve',{tradeId:t.id,businessKey,reason:'Manual order review'});return ok('/approvals/'+a.id+'/decide',{decision:'approved',reason:'Reviewed input and policy snapshot'},'risk_admin')}

test('unknown values stay null, zero is explicit, unit/FX/fee stress calculations are coherent',()=>{
 assert.equal(minor(''),null);assert.equal(minor('0'),0);assert.throws(()=>minor('-1'));assert.throws(()=>minor('1e2'));assert.throws(()=>minor('1.001'));
 const p=profile(),base={...trade('p'),amountMinor:100000,quantity:10,steelUnitCostMinor:10000,freightMinor:10000,fxRate:7,receivedMinor:0,releasedMinor:0};
 const e=evaluate(base,p,defaultRiskRules,null,new Date('2020-01-08T00:00:00Z'));
 assert.equal(e.baseCostMinor,110000);assert.equal(e.baseMarginMinor,590000);assert.equal(e.stressedMarginMinor,563000);assert.equal(e.overdueDays,7);assert.ok(e.warnings.includes('逾期升级'));
 const missing=evaluate({...base,amountMinor:null,freightPayer:null,fxRate:null}, {...p,financialEvidence:null},defaultRiskRules,null);
 assert.equal(missing.outstandingMinor,null);assert.equal(missing.stressedMarginMinor,null);assert.equal(missing.status,'资料待补齐');assert.ok(missing.missing.includes('合同金额'));
 const separate=evaluate({...base,freightIncluded:false},p,defaultRiskRules,null);assert.equal(separate.baseMarginMinor,600000); // Freight reimbursed only once.
 const counterparty=evaluate({...base,freightPayer:'counterparty',freightMinor:null},p,defaultRiskRules,null);assert.equal(counterparty.baseMarginMinor,600000);
 const kilos=evaluate({...base,quantity:10000,unit:'千克'},p,defaultRiskRules,null);assert.equal(kilos.baseCostMinor,e.baseCostMinor);
 const mismatch=evaluate({...base,unit:'件'},p,defaultRiskRules,null);assert.equal(mismatch.baseMarginMinor,null);assert.ok(mismatch.missing.includes('成本单位换算依据'));
 const purchase=evaluate({...base,direction:'purchase'},p,defaultRiskRules,null);assert.equal(purchase.baseMarginMinor,null);
 const warning=evaluate(base,p,defaultRiskRules,null,new Date('2020-01-02T00:00:00Z'));assert.ok(warning.warnings.includes('逾期预警'));assert.ok(!warning.warnings.includes('逾期升级'));
});

test('credit, reservation and partial receipt are transactional, idempotent and manually approved',async t=>{
 const {ok,req}=await setup(t),p=await ok('/profiles',profile()),o=await ok('/trades',trade(p.id));
 assert.equal((await ok('')).records.filter(x=>x.kind==='credit').length,0);
 const noCredit=await ok('/approvals/reserve',{tradeId:o.id,businessKey:'before-credit',reason:'No auto-credit'});assert.equal((await req('/approvals/'+noCredit.id+'/decide',{decision:'approved',reason:'Must not bypass approved limit'},'risk_admin')).status,409);
 await grant(ok,p);const approval=await reserve(ok,o);assert.equal(approval.status,'approved');
 const repeated=await ok('/approvals/'+approval.id+'/decide',{decision:'approved',reason:'Reviewed input and policy snapshot'},'risk_admin');assert.equal(repeated.id,approval.id);
 let state=await ok('');assert.equal(state.records.find(x=>x.kind==='credit').occupiedMinor,100000);assert.equal(state.records.filter(x=>x.kind==='ledger').length,1);
 const receiptBody={tradeId:o.id,businessKey:'bank-ref-001',amount:'300',source:'manual',sourceNote:'Bank fixture 001',reason:'Receipt evidence available'};
 const [a,b]=await Promise.all([ok('/approvals/receipt',receiptBody),ok('/approvals/receipt',receiptBody)]);assert.equal(a.id,b.id);
 const decision={decision:'approved',reason:'Confirmed funds received'};await Promise.all([ok('/approvals/'+a.id+'/decide',decision,'risk_admin'),ok('/approvals/'+a.id+'/decide',decision,'risk_admin')]);
 state=await ok('');assert.equal(state.records.find(x=>x.kind==='credit').occupiedMinor,70000);assert.equal(state.records.find(x=>x.id===o.id).receivedMinor,30000);assert.equal(state.records.filter(x=>x.kind==='ledger').length,2);
 assert.equal((await req('/approvals/receipt',{...receiptBody,amount:'301'})).status,409);
 const excessive=await ok('/approvals/receipt',{...receiptBody,businessKey:'too-much',amount:'701'});assert.equal((await req('/approvals/'+excessive.id+'/decide',decision,'risk_admin')).status,409);
 assert.equal((await ok('')).records.find(x=>x.kind==='credit').occupiedMinor,70000);
 const release=await ok('/approvals/release',{tradeId:o.id,businessKey:'cancel-1',reason:'Contract cancelled, no receipt implied'});await ok('/approvals/'+release.id+'/decide',decision,'risk_admin');
 state=await ok('');assert.equal(state.records.find(x=>x.kind==='credit').occupiedMinor,0);assert.equal(state.records.find(x=>x.id===o.id).receivedMinor,30000);assert.equal(state.records.find(x=>x.id===o.id).releasedMinor,70000);
 assert.equal((await req('/approvals/receipt',{...receiptBody,businessKey:'after-cancel'})).status,409);
 assert.equal((await ok('/audit/verify',null,'risk_admin')).ok,true);
});

test('concurrent reservations cannot overdraw credit and duplicate trade identifiers cannot create extra exposure',async t=>{
 const {ok,req}=await setup(t),p=await ok('/profiles',profile());await grant(ok,p,'1000');
 const o1=await ok('/trades',trade(p.id));const o2=await ok('/trades',trade(p.id,{businessKey:'contract-2'}));
 assert.equal((await ok('/trades',trade(p.id))).id,o1.id);assert.equal((await req('/trades',trade(p.id,{amount:'999'}))).status,409);
 const a=await ok('/approvals/reserve',{tradeId:o1.id,businessKey:'r1',reason:'Review'}),b=await ok('/approvals/reserve',{tradeId:o2.id,businessKey:'r2',reason:'Review'});
 const statuses=await Promise.all([a,b].map(a=>req('/approvals/'+a.id+'/decide',{decision:'approved',reason:'Concurrent review'},'risk_admin')));assert.deepEqual(statuses.map(r=>r.status).sort(),[200,409]);
 const state=await ok('');assert.equal(state.records.find(x=>x.kind==='credit').occupiedMinor,100000);assert.equal(state.records.filter(x=>x.kind==='ledger').length,1);
});

test('accounts cannot read, amend, import into or approve another account records',async t=>{
 const {ok,req}=await setup(t),p=await ok('/profiles',profile()),o=await ok('/trades',trade(p.id));
 assert.equal((await req('',null,'anonymous')).status,401);
 const other=await ok('',null,'risk_b');assert.equal(other.records.length,0);assert.equal(other.assessments.length,0);assert.equal(other.audit.length,0);
 assert.equal((await req('/profiles/'+p.id,{...profile(),version:1,reason:'Attack'},'risk_b','PATCH')).status,404);
 assert.equal((await req('/trades',trade(p.id,{businessKey:'attack'}),'risk_b')).status,404);
 const a=await ok('/approvals/credit',{profileId:p.id,currency:'USD',amount:'1000',businessKey:'a1',reason:'Review'});
 assert.equal((await req('/approvals/'+a.id+'/decide',{decision:'approved',reason:'Self approval'},'risk_a')).status,403);
 assert.equal((await req('/rules',{...defaultRiskRules,reason:'Attack'},'risk_b','PUT')).status,403);
 const body={kind:'trades',format:'json',content:JSON.stringify([trade(p.id)]),dataClass:'real',batchKey:'attack-batch',sourceNote:'Attack'};
 assert.equal((await req('/import',body,'risk_b')).status,404);assert.equal((await ok('',null,'risk_b')).records.length,0);
 assert.equal((await req('/trades/'+o.id+'/evaluate',{},'risk_b')).status,404);
});

test('missing information requires explicit override; example data cannot change real balances',async t=>{
 const {ok,req}=await setup(t),p=await ok('/profiles',profile({financialEvidence:''}));
 const a=await ok('/approvals/credit',{profileId:p.id,currency:'USD',amount:'1000',businessKey:'no-override',reason:'Incomplete'});
 assert.equal((await req('/approvals/'+a.id+'/decide',{decision:'approved',reason:'Must fail'},'risk_admin')).status,400);
 await grant(ok,p,'1000',{acknowledgeMissing:true});
 const o=await ok('/trades',trade(p.id,{steelUnitCost:''}));const r=await ok('/approvals/reserve',{tradeId:o.id,businessKey:'r1',reason:'Incomplete'});
 assert.equal((await req('/approvals/'+r.id+'/decide',{decision:'approved',reason:'Must fail'},'risk_admin')).status,400);
 const demo=await ok('/profiles',profile({businessKey:'demo',source:'example'}));
 assert.equal((await req('/approvals/credit',{profileId:demo.id,currency:'USD',amount:'1000',businessKey:'demo-credit',reason:'Must fail'})).status,400);
 const estimated=await ok('/trades',trade(p.id,{businessKey:'estimate-1',source:'estimate'}));assert.equal((await req('/approvals/reserve',{tradeId:estimated.id,businessKey:'estimate-r',reason:'Must fail'})).status,400);
});

test('rules and evaluations retain snapshots, alerts escalate and assignments are tenant constrained',async t=>{
 const {ok,req}=await setup(t),p=await ok('/profiles',profile()),o=await ok('/trades',trade(p.id));
 const original=(await ok('')).records.find(x=>x.kind==='evaluation');assert.equal(original.rulesSnapshot.version,1);
 const modified=await ok('/rules',{...defaultRiskRules,steelShockPct:'8',reason:'New trial assumption'},'risk_admin','PUT');assert.equal(modified.version,2);
 assert.equal((await req('/rules',{...defaultRiskRules,reason:'Stale overwrite'},'risk_admin','PUT')).status,409);
 await ok('/profiles/'+p.id,{...p,version:1,name:'Updated fixture',reason:'Correct name'},'risk_a','PATCH');
 const e=await ok('/trades/'+o.id+'/evaluate',{});assert.equal(e.rulesSnapshot.steelShockPct,8);assert.equal(e.profileSnapshot.name,'Updated fixture');assert.equal(original.profileSnapshot.name,p.name);
 const scan=await ok('/alerts/scan',{});assert.ok(scan.created>0);assert.equal((await ok('/alerts/scan',{})).created,0);
 const ticket=(await ok('')).records.find(x=>x.kind==='ticket'&&x.title==='逾期升级');assert.ok(ticket);
 assert.equal((await req('/tickets/'+ticket.id,{version:1,status:'resolved',assigneeId:'risk_b',reason:'Cross-account assignment'},'risk_a','PATCH')).status,400);
 await ok('/tickets/'+ticket.id,{version:1,status:'in_progress',assigneeId:'risk_admin',reason:'Investigating overdue test'},'risk_a','PATCH');
 assert.equal((await req('/tickets/'+ticket.id,{version:1,status:'resolved',assigneeId:'risk_a',reason:'Stale'},'risk_a','PATCH')).status,409);
 assert.equal((await ok('/audit/verify',null,'risk_admin')).ok,true);
});

test('CSV/JSON import is atomic, source-labelled, idempotent and cannot set ownership or approvals',async t=>{
 const {ok,req}=await setup(t);
 assert.deepEqual(parseRows('csv','name,notes\r\n"a,b","line 1\nline ""2"""\r\n'),[{name:'a,b',notes:'line 1\nline "2"'}]);assert.throws(()=>parseRows('csv','a,a\n1,2'));assert.throws(()=>parseRows('csv','a\n"unfinished'));
 const batch={kind:'profiles',format:'json',dataClass:'real',batchKey:'batch-1',sourceNote:'Customer ledger file',content:JSON.stringify([profile({businessKey:'i1'}),profile({businessKey:'i2',partyType:'invalid'})])};
 assert.equal((await req('/import',batch)).status,400);assert.equal((await ok('')).records.length,0);assert.equal((await ok('')).audit.length,0);
 batch.content=JSON.stringify([profile({businessKey:'i1'})]);const result=await ok('/import',batch);assert.equal(result.recordIds.length,1);assert.equal((await ok('/import',batch)).id,result.id);
 const imported=(await ok('')).records.find(x=>x.kind==='profile');assert.equal(imported.source,'import');assert.match(imported.sourceNote,/batch-1/);assert.equal(imported.ownerId,'risk_a');
 assert.equal((await req('/import',{...batch,content:JSON.stringify([profile({businessKey:'i2',ownerId:'risk_b'})]),batchKey:'evil'})).status,400);
 assert.equal((await req('/import',{...batch,sourceNote:'Changed payload'})).status,409);
 const csv=await ok('/import',{kind:'profiles',format:'csv',dataClass:'example',batchKey:'example',sourceNote:'Explicit sample file',content:'businessKey,name,partyType,country\nsample,Sample customer,customer,\n'});assert.equal(csv.recordIds.length,1);assert.equal((await ok('')).records.find(x=>x.id===csv.recordIds[0]).country,null);
});

test('application storage prevents audit mutations and tampering is detectable',async t=>{
 const {ok,store}=await setup(t);await ok('/profiles',profile());const row=(await store.all('risk_audit'))[0];
 assert.throws(()=>store.put('risk_audit',{...row,action:'tampered'}),/append only/);assert.throws(()=>store.remove('risk_audit',row.id),/append only/);
 assert.throws(()=>store.db.prepare('UPDATE risk_audit SET data=? WHERE id=?').run('{}',row.id),/append only/);
 assert.equal((await ok('/audit/verify',null,'risk_admin')).ok,true);
 const root=store.get('risk_locks','operations');store.put('risk_locks',{...root,sequence:root.sequence+1});assert.equal((await ok('/audit/verify',null,'risk_admin')).ok,false);
});

test('credit currencies stay isolated and unreserved incorrect contracts can be cancelled without fake receipts',async t=>{
 const {ok,req}=await setup(t),p=await ok('/profiles',profile());await grant(ok,p,'2000');
 const cny=await ok('/trades',trade(p.id,{currency:'CNY',businessKey:'cny-contract'}));const a=await ok('/approvals/reserve',{tradeId:cny.id,businessKey:'cny-reserve',reason:'USD must not cover CNY'});
 assert.equal((await req('/approvals/'+a.id+'/decide',{decision:'approved',reason:'Must respect currency'},'risk_admin')).status,409);
 const cancel=await ok('/approvals/release',{tradeId:cny.id,businessKey:'cancel-unreserved',reason:'Wrong currency input'});await ok('/approvals/'+cancel.id+'/decide',{decision:'approved',reason:'Cancel without financial ledger'},'risk_admin');
 const state=await ok('');assert.equal(state.records.filter(x=>x.kind==='ledger').length,0);assert.equal(state.assessments.find(e=>e.tradeId===cny.id).outstandingMinor,0);assert.equal(state.records.find(x=>x.kind==='credit').occupiedMinor,0);
});

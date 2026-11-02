import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase} from '../server/db.js';
import {createAccount} from '../server/auth.js';
import {createApp} from '../server/app.js';
const password='Flow-local-test-password9!',future=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
async function setup(t,{cash=false,dueDays=30}={}){
 const store=createDatabase(':memory:');for(const [username,role] of [['flow_seller','supplier'],['flow_buyer','buyer'],['flow_admin','admin'],['flow_other','buyer']])await createAccount(store,{username,password,role});
 store.put('suppliers',{id:'flow-supplier',ownerId:'flow_seller',name:'Explicit test supplier',isSample:false});store.put('products',{id:'flow-product',ownerId:'flow_seller',supplierId:'flow-supplier',name:'Explicit test steel',category:'钢卷',unit:'吨',price:100,cost:100,stock:100,moq:1,term:'FOB',status:'在售',catalogOnly:false,isSample:false});
 const server=createApp(store,{secureCookies:false}).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await store.close()});const base='http://127.0.0.1:'+server.address().port+'/api',cookies={};
 for(const user of ['flow_seller','flow_buyer','flow_admin','flow_other']){const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password})});assert.equal(r.status,200);cookies[user]=r.headers.get('set-cookie').split(';')[0]}
 const req=async(path,body,user='flow_seller',method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookies[user]||''},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 const ok=async(...args)=>{const r=await req(...args);assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.body};
 const p=await ok('/risk/profiles',{businessKey:'FLOW-CUSTOMER',name:'Fixture buyer',partyType:'customer',platformAccountId:'flow_buyer',country:'中国',registration:'Verified fixture registration',financialEvidence:'Reviewed fixture financials',performanceEvidence:'Fixture performance',source:'manual',sourceNote:'Test fixture only'});
 const order=await ok('/orders',{productId:'flow-product',quantity:10,buyer:p.name,email:'fixture@example.invalid',country:'中国',destination:'Fixture port'},'flow_buyer');
 const input={profileId:p.id,businessKey:'FLOW-SALE',direction:'sale',platformOrderId:order.id,currency:'USD',amount:'1000',quantity:10,unit:'吨',term:'FOB',paymentMode:cash?'cash':'credit',dueDate:future(dueDays),steelUnitCost:'100',steelCurrency:'CNY',steelCostUnit:'吨',freight:'0',freightCurrency:'CNY',freightPayer:'self',freightIncluded:true,fxRate:7,source:'manual',sourceNote:'Fixture contract'};
 const trade=await ok('/risk/trades',input);
 const approve=(a,extra={})=>ok('/risk/flow-approvals/'+a.id+'/decide',{decision:'approved',reason:'Independent fixture review',...extra},'flow_admin');
 const grant=async(amount='1500',businessKey='grant-1',extras={})=>{const a=await ok('/risk/approvals/credit',{profileId:p.id,currency:'USD',amount,validUntil:future(120),maxTermDays:90,conditions:'Explicit test conditions',businessKey,reason:'Fixture credit request',...extras});return ok('/risk/approvals/'+a.id+'/decide',{decision:'approved',reason:'Independent credit review'},'flow_admin')};
 const reserve=async()=>{const a=await ok('/risk/approvals/reserve',{tradeId:trade.id,businessKey:'reserve-1',reason:'Commit fixture exposure'});return ok('/risk/approvals/'+a.id+'/decide',{decision:'approved',reason:'Independent reservation review'},'flow_admin')};
 const invoice=(amount='1000',invoiceNumber='INV-1')=>ok('/risk/receivables',{tradeId:trade.id,amount,invoiceNumber,issuedDate:future(0),dueDate:future(dueDays),evidenceRef:'Invoice fixture reference'});
 const bank=async(amount='1000',bankReference='BANK-1',extras={})=>{const r=await ok('/risk/cash-receipts',{profileId:p.id,bankAccountRef:'Fixture USD account',bankReference,amount,currency:'USD',receivedDate:future(0),payerName:p.name,evidenceRef:'Bank statement fixture',source:'manual',...extras});await ok('/risk/cash-receipts/'+r.id+'/confirm',{fundsVerified:true,evidenceRef:'Independent account statement review',reason:'Verified fixture arrival'},'flow_admin');return r};
 const allocation=(r,items,businessKey='allocation-1')=>ok('/risk/flow-approvals/allocation',{receiptId:r.id,items,businessKey,reason:'Allocate fixture receipt'});
 const ready=async()=>{for(let i=0;i<3;i++)await ok('/orders/'+order.id+'/advance',{},'flow_seller','PATCH')};
 const requestShip=(businessKey='SHIP-1')=>ok('/risk/flow-approvals/shipment',{tradeId:trade.id,businessKey,contractRef:'Signed contract fixture',titleRef:'Warehouse release fixture',qualityRef:'Inspection and shipment fixture',reason:'Ship reviewed order'});
 const ship=(a)=>ok('/orders/'+order.id+'/advance',{shipmentApprovalId:a.id},'flow_seller','PATCH');
 const verify={counterpartyVerified:true,titleVerified:true,qualityVerified:true,verificationEvidence:'Independent document and ownership verification'};
 return {store,req,ok,p,trade,order,input,grant,reserve,invoice,bank,allocation,approve,ready,requestShip,ship,verify};
}

test('commitment to invoice to cash allocation to shipping never counts principal twice; shipping retries are idempotent',async t=>{
 const f=await setup(t);await f.grant();await f.reserve();const i1=await f.invoice('600','INV-A'),i2=await f.invoice('400','INV-B');let flow=await f.ok('/risk/flow');assert.equal(flow.exposures[0].occupiedMinor,100000);assert.equal(flow.exposures[0].receivableMinor,100000);assert.equal(flow.exposures[0].unbilledMinor,0);
 const r=await f.bank('500');assert.equal((await f.ok('/risk/flow')).exposures[0].allocatedMinor,0);
 const a=await f.allocation(r,[{invoiceId:i1.id,amount:'300'},{invoiceId:i2.id,amount:'200'}]);await f.approve(a);flow=await f.ok('/risk/flow');assert.equal(flow.exposures[0].occupiedMinor,50000);assert.equal(flow.exposures[0].receivableMinor,50000);assert.equal(flow.receipts[0].allocatedMinor,50000);
 await f.ready();assert.equal((await f.req('/orders/'+f.order.id+'/advance',{},'flow_seller','PATCH')).status,409);const shipment=await f.requestShip(),approval=await f.approve(shipment,f.verify);const [s1,s2]=await Promise.all([f.ship(approval),f.ship(approval)]);assert.equal(s1.status,'运输中');assert.equal(s2.status,'运输中');assert.equal((await f.ok('/risk/flow')).exposures[0].occupiedMinor,50000);assert.equal((await f.ok('/orders/'+f.order.id+'/risk-release')).gate.hard.includes('该订单已发货'),true);
 await f.ok('/orders/'+f.order.id+'/advance',{},'flow_seller','PATCH');assert.equal(f.store.get('orders',f.order.id).status,'已完成');assert.equal((await f.ok('/risk/audit/verify',null,'flow_admin')).ok,true);
});

test('confirmed prepayment can settle before credit reservation; only remaining principal is occupied',async t=>{
 const f=await setup(t);const invoice=await f.invoice(),r=await f.bank('400');await f.approve(await f.allocation(r,[{invoiceId:invoice.id,amount:'400'}]));let flow=await f.ok('/risk/flow');assert.equal(flow.exposures[0].occupiedMinor,0);assert.equal(flow.exposures[0].uncoveredMinor,60000);await f.grant('600','net-grant',{maxSingleAmount:'600'});await f.reserve();flow=await f.ok('/risk/flow');assert.equal(flow.exposures[0].occupiedMinor,60000);assert.equal(flow.exposures[0].receivableMinor,60000);
});

test('cash shipping requires allocated independently confirmed funds; no credit is silently granted',async t=>{
 const f=await setup(t,{cash:true});const invoice=await f.invoice();await f.ready();const r=await f.bank();let a=await f.requestShip();let denied=await f.req('/risk/flow-approvals/'+a.id+'/decide',{decision:'approved',reason:'Cannot bypass funds',...f.verify,exceptionApproved:true,exceptionReason:'Test',compensatingControls:'Test'},'flow_admin');assert.equal(denied.status,409);
 await f.approve(await f.allocation(r,[{invoiceId:invoice.id,amount:'1000'}]));a=await f.approve(await f.requestShip('CASH-SHIP'),f.verify);await f.ship(a);assert.equal(f.store.all('risk_records').filter(x=>x.kind==='credit').length,0);assert.equal(f.store.get('risk_records',f.trade.id).receivedMinor,100000);
});

test('pending arrivals, duplicate bank references, cross-account and cross-currency allocations cannot bypass reconciliation',async t=>{
 const f=await setup(t);const invoice=await f.invoice();const body={profileId:f.p.id,bankAccountRef:'Fixture USD account',bankReference:'REF-ONE',amount:'1000',currency:'USD',receivedDate:future(0),payerName:f.p.name,evidenceRef:'Fixture evidence',source:'manual'};
 const r=await f.ok('/risk/cash-receipts',body);assert.equal((await f.req('/risk/flow-approvals/allocation',{receiptId:r.id,items:[{invoiceId:invoice.id,amount:'1000'}],businessKey:'pending',reason:'Test'})).status,409);assert.equal((await f.req('/risk/cash-receipts',{...body,bankReference:'ref-one',amount:'999'})).status,409);
 assert.equal((await f.req('/risk/cash-receipts/'+r.id+'/confirm',{fundsVerified:true,evidenceRef:'X',reason:'X'},'flow_seller')).status,403);
 const cny=await f.bank('1000','CNY-1',{currency:'CNY'});assert.equal((await f.req('/risk/flow-approvals/allocation',{receiptId:cny.id,items:[{invoiceId:invoice.id,amount:'10'}],businessKey:'FX',reason:'Cross currency'})).status,400);
 assert.equal((await f.req('/risk/cash-receipts/'+r.id+'/confirm',{fundsVerified:true,evidenceRef:'X',reason:'X'},'flow_other')).status,403);assert.equal((await f.req('/risk/flow-approvals/allocation',{receiptId:cny.id,items:[{invoiceId:invoice.id,amount:'10'}],businessKey:'tenant',reason:'Cross owner'},'flow_other')).status,404);
 assert.equal((await f.req('/risk/approvals/receipt',{})).status,409);
});

test('concurrent allocations cannot overdraw an arrival and a multi-invoice failure rolls back earlier updates',async t=>{
 const f=await setup(t);await f.grant();await f.reserve();const i1=await f.invoice('500','PART-1'),i2=await f.invoice('500','PART-2'),r=await f.bank('1000');const bad=await f.allocation(r,[{invoiceId:i1.id,amount:'400'},{invoiceId:i2.id,amount:'600'}],'bad-batch');assert.equal((await f.req('/risk/flow-approvals/'+bad.id+'/decide',{decision:'approved',reason:'Should roll back'},'flow_admin')).status,409);assert.equal(f.store.get('risk_records',i1.id).paidMinor,0);assert.equal(f.store.get('risk_records',r.id).allocatedMinor,0);
 const a=await f.allocation(r,[{invoiceId:i1.id,amount:'400'},{invoiceId:i2.id,amount:'400'}],'race-1'),b=await f.allocation(r,[{invoiceId:i1.id,amount:'400'},{invoiceId:i2.id,amount:'400'}],'race-2');const results=await Promise.all([a,b].map(a=>f.req('/risk/flow-approvals/'+a.id+'/decide',{decision:'approved',reason:'Race review'},'flow_admin')));assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(f.store.get('risk_records',r.id).allocatedMinor,80000);
});

test('reversal restores debt and occupancy even over a lowered limit, freezes exposure, and cannot be repeated',async t=>{
 const f=await setup(t);await f.grant();await f.reserve();const invoice=await f.invoice(),r=await f.bank('600'),a=await f.allocation(r,[{invoiceId:invoice.id,amount:'600'}]);await f.approve(a);await f.grant('500','lower-limit');const reverse=await f.ok('/risk/flow-approvals/reversal',{allocationId:a.id,businessKey:'REV-1',reason:'Misallocation correction'});await f.approve(reverse);await f.approve(reverse);let state=await f.ok('/risk');const credit=state.records.find(x=>x.kind==='credit');assert.equal(credit.occupiedMinor,100000);assert.equal(credit.frozen,true);assert.equal(f.store.get('risk_records',invoice.id).paidMinor,0);assert.equal(f.store.get('risk_records',f.trade.id).receivedMinor,0);assert.equal(f.store.get('risk_records',r.id).allocatedMinor,0);
 const voided=await f.ok('/risk/flow-approvals/receipt_void',{receiptId:r.id,businessKey:'VOID-BANK',reason:'Invalid arrival correction'});await f.approve(voided);assert.equal(f.store.get('risk_records',r.id).status,'voided');assert.equal((await f.req('/risk/flow-approvals/allocation',{receiptId:r.id,items:[{invoiceId:invoice.id,amount:'100'}],businessKey:'again',reason:'No reuse'})).status,409);
});

test('shipment authorization changes are invalidated, exceptions require reasons, and expired approvals cannot ship',async t=>{
 const f=await setup(t,{dueDays:1});await f.grant();await f.reserve();const invoice=await f.invoice();await f.ready();const approved=await f.approve(await f.requestShip(),f.verify);const r=await f.bank('100');await f.approve(await f.allocation(r,[{invoiceId:invoice.id,amount:'100'}]));assert.equal((await f.req('/orders/'+f.order.id+'/advance',{shipmentApprovalId:approved.id},'flow_seller','PATCH')).status,409);
 t.mock.timers.enable({apis:['Date'],now:Date.now()+2*86400000});const pending=await f.requestShip('AGED');assert.equal((await f.req('/risk/flow-approvals/'+pending.id+'/decide',{decision:'approved',reason:'No exception',...f.verify},'flow_admin')).status,409);assert.equal((await f.req('/risk/flow-approvals/'+pending.id+'/decide',{decision:'approved',reason:'Missing compensating measures',...f.verify,exceptionApproved:true},'flow_admin')).status,400);
 const current=await f.approve(pending,{...f.verify,exceptionApproved:true,exceptionReason:'Documented delayed transfer fixture',compensatingControls:'Partial payment verified and executive review'});t.mock.timers.setTime(Date.now()+2*86400000);assert.equal((await f.req('/orders/'+f.order.id+'/advance',{shipmentApprovalId:current.id},'flow_seller','PATCH')).status,409);
});

test('a customer profile cannot borrow another buyer identity or let an unrelated supplier bind the sale',async t=>{
 const f=await setup(t);const wrong=await f.ok('/risk/profiles',{businessKey:'wrong',name:'Wrong buyer',partyType:'customer',platformAccountId:'flow_other',source:'manual',sourceNote:'Fixture'});assert.equal((await f.req('/risk/trades',{...f.input,profileId:wrong.id,businessKey:'wrong-order'})).status,400);
 assert.equal((await f.req('/risk/profiles/'+f.p.id,{...f.p,platformAccountId:'flow_other',version:1,reason:'Change borrower'},'flow_seller','PATCH')).status,400);
 const second=await f.req('/risk/trades',{...f.input,businessKey:'duplicate-envelope'});assert.equal(second.status,409);
 assert.equal((await f.req('/orders/'+f.order.id+'/risk-release',null,'flow_buyer')).status,404);
});

test('maker-checker applies to credit and all financial decisions, and archive does not hide real debt',async t=>{
 const f=await setup(t);const a=await f.ok('/risk/approvals/credit',{profileId:f.p.id,currency:'USD',amount:'1000',validUntil:future(90),maxTermDays:30,conditions:'Fixture',businessKey:'admin-made',reason:'Test'},'flow_admin');assert.equal((await f.req('/risk/approvals/'+a.id+'/decide',{decision:'approved',reason:'Self approval'},'flow_admin')).status,403);
 assert.equal((await f.req('/risk/trades/'+f.trade.id+'/archive',{reason:'Hide debt'})).status,409);const invoice=await f.invoice();assert.equal((await f.req('/risk/flow-approvals/invoice_void',{invoiceId:invoice.id,businessKey:'made-by-admin',reason:'Test'},'flow_other')).status,404);
 const r=await f.bank('500'),batch=await f.allocation(r,[{invoiceId:invoice.id,amount:'500'}]);assert.equal((await f.req('/risk/flow-approvals/'+batch.id+'/decide',{decision:'approved',reason:'Wrong role'},'flow_seller')).status,403);
});

test('legacy opening reconciliation links prior receipts without double releasing credit and supports an auditable unmatch',async t=>{
 const f=await setup(t);await f.grant();await f.reserve();const invoice=await f.invoice();const trade=f.store.get('risk_records',f.trade.id),credit=f.store.all('risk_records').find(x=>x.kind==='credit');f.store.put('risk_records',{...trade,receivedMinor:30000});f.store.put('risk_records',{...credit,occupiedMinor:70000});
 const match=await f.ok('/risk/flow-approvals/opening_match',{tradeId:trade.id,items:[{invoiceId:invoice.id,amount:'300'}],evidenceRef:'Legacy reconciliation fixture',businessKey:'OPEN-1',reason:'Match historical ledger'});await f.approve(match);assert.equal(f.store.get('risk_records',invoice.id).paidMinor,30000);assert.equal(f.store.get('risk_records',trade.id).receivedMinor,30000);assert.equal(f.store.get('risk_records',credit.id).occupiedMinor,70000);
 const reverse=await f.ok('/risk/flow-approvals/reversal',{allocationId:match.id,businessKey:'OPEN-REV',reason:'Correct opening assignment'});await f.approve(reverse);assert.equal(f.store.get('risk_records',invoice.id).paidMinor,0);assert.equal(f.store.get('risk_records',trade.id).receivedMinor,30000);assert.equal(f.store.get('risk_records',credit.id).occupiedMinor,70000);
});

test('tenor, maturity, profile-version and frozen credit are hard controls that exception reasons cannot bypass',async t=>{
 const f=await setup(t);await f.grant('1500','short-tenor',{maxTermDays:7});let a=await f.ok('/risk/approvals/reserve',{tradeId:f.trade.id,businessKey:'attempt',reason:'Test tenor'});assert.equal((await f.req('/risk/approvals/'+a.id+'/decide',{decision:'approved',reason:'Review'},'flow_admin')).status,409);
 await f.grant('1500','proper-tenor');await f.ok('/risk/approvals/'+a.id+'/decide',{decision:'approved',reason:'Current policy now reviewed'},'flow_admin');await f.invoice();await f.ready();await f.ok('/risk/profiles/'+f.p.id,{...f.p,financialEvidence:'Updated evidence fixture',version:1,reason:'New financial statement'},'flow_seller','PATCH');const request=await f.requestShip('STALE-PROFILE');const body={decision:'approved',reason:'Cannot bypass',...f.verify,exceptionApproved:true,exceptionReason:'Test',compensatingControls:'Test'};assert.equal((await f.req('/risk/flow-approvals/'+request.id+'/decide',body,'flow_admin')).status,409);
 await f.grant('1500','re-reviewed-profile');const account=f.store.all('risk_records').find(x=>x.kind==='credit');await f.ok('/risk/credits/'+account.id+'/freeze',{reason:'Creditor hold fixture'},'flow_admin');assert.equal((await f.req('/risk/flow-approvals/'+request.id+'/decide',body,'flow_admin')).status,409);
});

test('an accepted overdue exception becomes stale when aging advances across the UTC day',async t=>{
 const f=await setup(t,{dueDays:1});await f.grant();await f.reserve();await f.invoice();await f.ready();t.mock.timers.enable({apis:['Date'],now:Date.now()+2*86400000});const a=await f.approve(await f.requestShip(),{...f.verify,exceptionApproved:true,exceptionReason:'Fixture accepted one-day arrears',compensatingControls:'Daily review'});t.mock.timers.setTime(Date.now()+12*3600000); // May cross a UTC boundary, while remaining inside the 24-hour authorization window.
 const target=new Date(a.decidedAt);target.setUTCHours(24,0,1,0);t.mock.timers.setTime(target.getTime());assert.ok(Date.now()<Date.parse(a.expiresAt));assert.equal((await f.req('/orders/'+f.order.id+'/advance',{shipmentApprovalId:a.id},'flow_seller','PATCH')).status,409);
});

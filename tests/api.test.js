import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { calculateProfit } from '../server/domain.js';
async function setup(t) {
  const store=createDatabase(':memory:');
  const server=createApp(store).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();store.db.close();});
  const request=async(path,body,method='POST')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,body?{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:r.status,body:await r.json()};};
  return {store,request};
}
const order={productId:'p1',quantity:25,buyer:'Test Buyer LLC',email:'test@example.com',country:'阿联酋',destination:'杰贝阿里港'};
test('profit includes currency conversion, per-ton logistics and platform commission',()=>{
  const r=calculateProfit({price:600,cost:3500,quantity:100,freight:20,other:500,feeRate:2,exchangeRate:7});
  assert.deepEqual(r,{revenue:60000,purchaseCost:50000,platformFee:1200,logistics:2000,expenses:53700,profit:6300,margin:10.5,perTon:63});
});
test('profit supports loss and rejects invalid exchange rates and fees',()=>{
  assert.ok(calculateProfit({price:400,cost:3500,quantity:100,exchangeRate:7}).profit<0);
  for(const exchangeRate of [0,-1,NaN])assert.throws(()=>calculateProfit({price:500,cost:3000,quantity:100,exchangeRate}));
  assert.throws(()=>calculateProfit({price:500,cost:3000,quantity:100,feeRate:101}));
});
test('bootstrap loads meaningful demo data',async t=>{const {request}=await setup(t);const r=await request('/bootstrap');assert.equal(r.status,200);assert.equal(r.body.products.length,16);assert.equal(r.body.suppliers.length,6);assert.equal(r.body.orders.length,4);});
test('orders use server price, reserve inventory and persist fulfillment history',async t=>{
  const {request,store}=await setup(t),stock=store.get('products','p1').stock;
  const r=await request('/orders',{...order,total:1,unitPrice:1});assert.equal(r.status,201);assert.equal(r.body.total,13200);assert.equal(r.body.unitPrice,528);assert.equal(store.get('products','p1').stock,stock-25);
  const next=await request('/orders/'+r.body.id+'/advance',{},'PATCH');assert.equal(next.body.status,'合同确认');assert.equal(next.body.history.length,2);
});
test('orders reject under-MOQ, fractional, overstock, invalid email and hidden products without inventory changes',async t=>{
  const {request,store}=await setup(t),stock=store.get('products','p1').stock;
  for(const quantity of [0,24,25.5,stock+1])assert.equal((await request('/orders',{...order,quantity})).status,400);
  assert.equal((await request('/orders',{...order,email:'invalid'})).status,400);
  assert.equal(store.get('products','p1').stock,stock);
  await request('/products/p1',{status:'已下架'},'PATCH');
  assert.equal((await request('/orders',order)).status,400);
});
test('inventory cannot be oversold by multiple requests',async t=>{
  const {request,store}=await setup(t);store.put('products',{...store.get('products','p1'),stock:30});
  const results=await Promise.all([request('/orders',order),request('/orders',order)]);
  assert.deepEqual(results.map(x=>x.status).sort(),[201,400]);assert.equal(store.get('products','p1').stock,5);
});
test('supplier onboarding, duplicate check and approval creates a supplier',async t=>{
  const {request,store}=await setup(t);const input={company:'测试钢铁企业',registration:'91310000TEST000001',contact:'王经理',email:'sales@example.com',location:'中国 · 上海',category:'钢卷',capacity:100000,certifications:'ISO 9001'};
  const r=await request('/applications',input);assert.equal(r.status,201);assert.equal(r.body.status,'待审核');
  assert.equal((await request('/applications',input)).status,400);
  const approved=await request('/applications/'+r.body.id,{status:'已通过'},'PATCH');assert.equal(approved.body.status,'已通过');assert.equal(store.get('suppliers',r.body.id).name,input.company);
  assert.equal((await request('/applications/'+r.body.id,{status:'已通过'},'PATCH')).status,400);
});
test('product validation protects category, price, MOQ and supplier linkage',async t=>{
  const {request}=await setup(t);const p={name:'出口钢卷',en:'Steel Coil',category:'钢卷',grade:'Q235B',spec:'3×1250 mm',price:550,cost:3000,stock:1000,moq:25,supplierId:'s1',port:'上海港'};
  assert.equal((await request('/products',{...p,price:-1})).status,400);
  assert.equal((await request('/products',{...p,moq:1001})).status,400);
  assert.equal((await request('/products',{...p,supplierId:'missing'})).status,400);
  assert.equal((await request('/products',{...p,category:'bad'})).status,400);
  const r=await request('/products',p);assert.equal(r.status,201);assert.equal(r.body.status,'在售');
});
test('inquiries can be quoted once and require valid quantity',async t=>{
  const {request}=await setup(t);const b={productId:'p1',quantity:50,buyer:'Test',email:'test@example.com',country:'越南',message:'需要 SGS 验货及 FOB 报价'};
  assert.equal((await request('/inquiries',{...b,quantity:1})).status,400);
  const r=await request('/inquiries',b);assert.equal(r.status,201);
  const quoted=await request('/inquiries/'+r.body.id+'/quote',{price:530},'PATCH');assert.equal(quoted.body.status,'已报价');assert.equal(quoted.body.quotedPrice,530);
  assert.equal((await request('/inquiries/'+r.body.id+'/quote',{price:531},'PATCH')).status,400);
});
test('completed order cannot advance and unknown API routes return JSON',async t=>{
  const {request}=await setup(t);assert.equal((await request('/orders/SF-202610-0085/advance',{},'PATCH')).status,400);
  assert.equal((await request('/does-not-exist')).status,404);
});

test('SQLite keeps saved data after a close and reopen without duplicating seed records',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'steelflow-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'persist.db');const first=createDatabase(file);
  first.put('applications',{id:'persist-check',company:'持久化测试',status:'待审核'});first.db.close();
  const second=createDatabase(file);assert.equal(second.get('applications','persist-check').company,'持久化测试');assert.equal(second.all('products').length,16);second.db.close();
});

test('piece-based order snapshots its unit and cannot use a client price',async t=>{const {request}=await setup(t);const r=await request('/orders',{...order,productId:'t1',quantity:20,total:1});assert.equal(r.status,201);assert.equal(r.body.unit,'件');assert.equal(r.body.total,850)});
test('batch inquiries are atomic, preserve units and do not reserve inventory',async t=>{const {request,store}=await setup(t);const before=store.all('inquiries').length,stock=store.get('products','t1').stock;const b={buyer:'Mixed buyer',email:'buyer@example.com',country:'肯尼亚',message:'Test mixed sourcing',items:[{productId:'t1',quantity:20},{productId:'p1',quantity:25}]};const r=await request('/inquiries/batch',b);assert.equal(r.status,201);assert.deepEqual(r.body.items.map(x=>x.unit),['件','吨']);assert.equal(store.get('products','t1').stock,stock);assert.equal(store.all('inquiries').length,before+2);assert.equal((await request('/inquiries/batch',{...b,items:[...b.items,{productId:'missing',quantity:1}]})).status,400);assert.equal(store.all('inquiries').length,before+2)});
test('custom sourcing supports an unlisted product but validates quantity and unit',async t=>{const {request}=await setup(t);const b={productName:'Custom pump',category:'其他采购',quantity:50,unit:'件',buyer:'Pump importer',email:'p@example.com',country:'尼日利亚',message:'24V with delivery to Lagos'};assert.equal((await request('/inquiries/custom',b)).status,201);assert.equal((await request('/inquiries/custom',{...b,unit:'bad'})).status,400);assert.equal((await request('/inquiries/custom',{...b,quantity:1.5})).status,400)});

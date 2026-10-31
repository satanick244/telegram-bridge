import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createMysqlDatabase} from '../server/storage.js';
import {createAccount} from '../server/auth.js';
import {createApp} from '../server/app.js';
const configFile=process.env.MYSQL_TEST_CONFIG_FILE;
test('MySQL risk ledger: cross-connection locks, concurrent receipts, rollback, durable audit and idempotent backup import',{skip:!configFile},async t=>{
 const config=JSON.parse(fs.readFileSync(configFile));assert.equal(config.host,'127.0.0.1');assert.ok(config.database.endsWith('_test'));
 let store=await createMysqlDatabase(config),second=await createMysqlDatabase(config);const servers=[];t.after(async()=>{for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r))}await store.close();await second.close()});
 const username='risk_mysql_'+randomUUID().slice(0,8),password='Isolated-MySQL-risk-test9!';await createAccount(store,{username,password,role:'admin'});
 async function api(s){const server=createApp(s,{secureCookies:false}).listen(0,'127.0.0.1');servers.push(server);await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/api';const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];return async(path,body,check=true)=>{const r=await fetch(base+'/risk'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(check)assert.ok(r.ok,JSON.stringify(data));return {status:r.status,body:data}}}
 const a=await api(store),b=await api(second);const p=(await a('/profiles',{businessKey:username,name:'Isolated MySQL fixture',partyType:'customer',source:'manual',sourceNote:'Test only',country:'中国',registration:'Fixture',financialEvidence:'Fixture',performanceEvidence:'Fixture'})).body;
 const credit=(await a('/approvals/credit',{profileId:p.id,businessKey:username+'-credit',currency:'USD',amount:'1000',reason:'Test only'})).body;await a('/approvals/'+credit.id+'/decide',{decision:'approved',reason:'Test approved'});
 const input={profileId:p.id,direction:'sale',currency:'USD',amount:'1000',quantity:10,unit:'吨',term:'FOB',paymentMode:'credit',dueDate:'2020-01-01',steelUnitCost:'100',steelCurrency:'CNY',steelCostUnit:'吨',freight:'0',freightCurrency:'USD',freightPayer:'self',freightIncluded:true,fxRate:7.12,source:'manual',sourceNote:'Test fixture'};
 const o1=(await a('/trades',{...input,businessKey:username+'-order1'})).body,o2=(await b('/trades',{...input,businessKey:username+'-order2'})).body;
 const r1=(await a('/approvals/reserve',{tradeId:o1.id,businessKey:username+'-r1',reason:'Review'})).body,r2=(await b('/approvals/reserve',{tradeId:o2.id,businessKey:username+'-r2',reason:'Review'})).body;
 const decisions=await Promise.all([a('/approvals/'+r1.id+'/decide',{decision:'approved',reason:'Concurrent test'},false),b('/approvals/'+r2.id+'/decide',{decision:'approved',reason:'Concurrent test'},false)]);assert.deepEqual(decisions.map(x=>x.status).sort(),[200,409]);
 const winning=decisions[0].status===200?o1:o2;
 const receipt={tradeId:winning.id,source:'manual',sourceNote:'Test bank receipt',reason:'Bank receipt test',amount:'600'};
 const pay1=(await a('/approvals/receipt',{...receipt,businessKey:username+'-bank1'})).body,pay2=(await b('/approvals/receipt',{...receipt,businessKey:username+'-bank2'})).body;
 const payments=await Promise.all([a('/approvals/'+pay1.id+'/decide',{decision:'approved',reason:'Verified'},false),b('/approvals/'+pay2.id+'/decide',{decision:'approved',reason:'Verified'},false)]);assert.deepEqual(payments.map(x=>x.status).sort(),[200,409]);
 const successful=payments.find(x=>x.status===200).body;const retry=await b('/approvals/'+successful.id+'/decide',{decision:'approved',reason:'Verified'});assert.equal(retry.body.id,successful.id);
 const state=(await a('')).body;assert.equal(state.records.find(x=>x.kind==='credit'&&x.profileId===p.id).occupiedMinor,40000);assert.equal(state.records.find(x=>x.id===winning.id).receivedMinor,60000);assert.equal(state.records.filter(x=>x.kind==='ledger'&&x.tradeId===winning.id).length,2);
 assert.equal((await a('/audit/verify')).body.ok,true);
 const row=(await store.all('risk_audit'))[0];await assert.rejects(store.put('risk_audit',row),/append only/);await assert.rejects(store.remove('risk_audit',row.id),/append only/);
 // Fresh adapter observes the same committed balance and audit chain.
 const reopened=await createMysqlDatabase(config);try{const persisted=await reopened.all('risk_records');assert.equal(persisted.find(x=>x.id===winning.id).receivedMinor,60000)}finally{await reopened.close()}
 // The existing backup import must accept an identical full snapshot twice without changing the chain.
 const backup={format:'induport-backup-v1',tables:{}};for(const k of ['users','suppliers','products','applications','orders','inquiries','risk_records','risk_audit','risk_locks'])backup.tables[k]=await store.all(k);
 const file='/tmp/'+username+'.backup.json';fs.writeFileSync(file,JSON.stringify(backup),{mode:0o600});
 const env={...process.env,DATABASE_CLIENT:'mysql',MYSQL_HOST:config.host,MYSQL_PORT:String(config.port),MYSQL_DATABASE:config.database,MYSQL_USER:config.user,MYSQL_PASSWORD:config.password,MYSQL_SSL:'false'};
 try{for(let i=0;i<2;i++){const r=spawnSync(process.execPath,['scripts/import-backup.mjs',file],{encoding:'utf8',env});assert.equal(r.status,0,r.stderr)}}finally{fs.rmSync(file,{force:true})}
 assert.equal((await a('/audit/verify')).body.ok,true);
});

test('MySQL demo accounts: concurrent first sign-in, durable examples and real-view isolation',{skip:!configFile},async t=>{
 const {getDemoAccount}=await import('../server/demo.js');const {hashPassword}=await import('../server/auth.js');
 const config=JSON.parse(fs.readFileSync(configFile));assert.equal(config.host,'127.0.0.1');assert.ok(config.database.endsWith('_test'));
 const a=await createMysqlDatabase(config),b=await createMysqlDatabase(config);const servers=[];t.after(async()=>{for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r))}await a.close();await b.close()});
 const [one,two]=await Promise.all([getDemoAccount(a,'buyer',hashPassword),getDemoAccount(b,'buyer',hashPassword)]);assert.equal(one.id,two.id);assert.equal(one.isDemo,true);
 await getDemoAccount(b,'supplier',hashPassword);const audit=await a.all('risk_audit');assert.equal(audit.filter(x=>x.action==='demo.seed').length,2);const root=await a.get('risk_locks','operations');assert.equal(root.sequence,audit.length);
 const server=createApp(a,{secureCookies:false}).listen(0,'127.0.0.1');servers.push(server);await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/api';
 const login=await fetch(base+'/auth/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'supplier'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const risk=await (await fetch(base+'/risk',{headers:{Cookie:cookie}})).json();assert.equal(risk.demo,true);assert.equal(risk.records.filter(x=>x.kind==='profile').length,3);assert.ok(risk.records.every(x=>x.isDemo&&x.ownerId!==one.id));
 const write=await fetch(base+'/risk/import',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(write.status,403);
 const publicData=await (await fetch(base+'/bootstrap')).json();assert.equal(publicData.products.length,48);assert.equal(publicData.suppliers.length,0);assert.equal(publicData.orders.length,0);
 const reopened=await createMysqlDatabase(config);try{assert.equal((await reopened.get('users',one.id)).isDemo,true);assert.equal((await reopened.all('risk_records')).filter(x=>x.kind==='profile'&&x.ownerId===one.id).length,3)}finally{await reopened.close()}
});

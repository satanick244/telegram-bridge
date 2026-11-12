// Explicit localhost-only migration fixture, never used by production startup.
import {createMysqlDatabase} from '../server/storage.js';import {createAccount,hashPassword} from '../server/auth.js';import {createApp} from '../server/app.js';import {once} from 'node:events';import {createHash} from 'node:crypto';
export async function seedJavaCompatibility(config){
 if(config.host!=='127.0.0.1'||!config.database.endsWith('_test'))throw Error('Refusing non-local migration fixture');
 const store=await createMysqlDatabase({...config,ssl:false});let server;
 try{
  await createAccount(store,{username:'java_legacy_fixture',password:'Legacy-fixture-Password9!',role:'buyer'});
  const token='ab'.repeat(32);await store.put('sessions',{id:createHash('sha256').update(token).digest('hex'),userId:'java_legacy_fixture',expiresAt:Date.now()+86400000});
  server=createApp(store,{secureCookies:false}).listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/api';
  const call=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'induport_session='+token},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw Error('Compatibility fixture failed: '+r.status);return b};
  const p=await call('/risk/profiles',{name:'Explicit migration fixture',partyType:'customer',businessKey:'legacy-migration-profile',country:'中国',registration:'Fixture identity',financialEvidence:'Fixture statement',performanceEvidence:'Fixture history',source:'manual',sourceNote:'Isolated Node-to-Java fixture'});
  await call('/risk/trades',{profileId:p.id,businessKey:'legacy-migration-trade',direction:'sale',currency:'USD',amount:'1000',quantity:10,unit:'吨',term:'FOB',paymentMode:'credit',dueDate:new Date(Date.now()+30*86400000).toISOString().slice(0,10),steelUnitCost:'100',steelCurrency:'CNY',steelCostUnit:'吨',freight:'0',freightCurrency:'CNY',freightPayer:'self',freightIncluded:true,fxRate:7,source:'manual',sourceNote:'Isolated Node contract'});
  await store.insert('users',{id:'induport_demo_supplier_v1',username:'induport_demo_supplier_v1',displayName:'Legacy demo fixture',role:'supplier',isDemo:true,demoSeedVersion:1,passwordHash:await hashPassword('Legacy-demo-fixture-password9!'),createdAt:new Date().toISOString()});
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await store.close();}
}

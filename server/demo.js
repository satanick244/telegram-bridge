import {randomBytes,randomUUID} from 'node:crypto';
import {digest} from './risk-domain.js';
import {buildDemoScenarios,demoSeedVersion,scenarioSourceNote} from './demo-scenarios.js';

export const demoAccountNames=Object.freeze({buyer:'induport_demo_buyer_v1',supplier:'induport_demo_supplier_v1'});
const error=(status,message)=>Object.assign(new Error(message),{status});
const sourceNote='InduPort 功能演示数据；企业、合同、库存、金额均为虚构算例，不代表实际交易、供应或资质。';

function seedRecords(user,asOf){
 const ownerId=user.id,base={ownerId,isDemo:true,demoSetVersion:demoSeedVersion,source:'example',inputMethod:'demo',sourceNote,createdAt:asOf.toISOString()},prefix='demo:'+user.role+':v2:';
 const supplier={id:prefix+'business-supplier',ownerId,name:'【演示】供应商 A · 虚构训练企业',en:'DEMO supplier — fictional training case',location:'示例场景 · 非实际所在地',contact:'演示联系人（非真实人员）',verified:false,certifications:'无真实认证资料 · 仅供功能演示',years:null,score:null,isDemo:true,source:'example'};
 const products=[{id:prefix+'business-product',ownerId,name:'【演示】热轧钢卷 · 交易算例',en:'DEMO hot rolled coil — not an offer',category:'钢卷',grade:'演示规格 · 非实际供货',spec:'仅用于界面展示',unit:'吨',price:600,cost:3300,stock:100,moq:10,port:'示例装运港',term:'FOB',supplierId:supplier.id,image:'coil',certifications:'无真实认证资料',featured:false,lead:'演示交期',status:'在售',createdAt:asOf.toISOString(),isDemo:true,source:'example',sourceNote}];
 const order={id:prefix+'business-order',ownerId,productId:products[0].id,productName:products[0].name,supplierId:supplier.id,buyer:'【演示】客户 A · 虚构训练企业',email:'demo@example.invalid',country:'示例目的国',destination:'示例目的港',quantity:40,unit:'吨',unitPrice:600,costCny:3300,exchangeRate:7.12,feeRate:2,total:24000,status:'合同确认',term:'FOB',createdAt:asOf.toISOString(),history:[{status:'待确认',at:asOf.toISOString()},{status:'合同确认',at:asOf.toISOString()}],isDemo:true,source:'example',sourceNote};
 const inquiry={id:prefix+'business-inquiry',ownerId,productId:products[0].id,productName:products[0].name,supplierId:supplier.id,buyer:'【演示】客户 B · 虚构询价',email:'demo@example.invalid',country:'示例目的国',quantity:20,unit:'吨',message:'【演示】询价场景：核对材质、交期、付款条件；不代表真实采购意向。',status:'待报价',createdAt:asOf.toISOString(),isDemo:true,source:'example',sourceNote};
 const business={...base,id:prefix+'business',kind:'demo_business',products,suppliers:[supplier],orders:[order],inquiries:[inquiry],applications:[]};
 return [...buildDemoScenarios(user,asOf),business];
}

export async function getDemoAccount(store,role,hashPassword){
 if(typeof role!=='string'||!Object.hasOwn(demoAccountNames,role))throw error(400,'仅提供买家和供应商演示，不提供管理员演示');
 const id=demoAccountNames[role];
 // Compute hashes outside the transaction; passwords are random, never exposed or needed to sign in.
 const passwordHash=await hashPassword(randomBytes(32).toString('hex'));
 return store.transaction(async tx=>{
  const root=await tx.get('risk_locks','operations');if(!root)throw Error('Risk lock is not initialized');
  let user=await tx.get('users',id);
  const priorVersion=user?.demoSeedVersion||0;
  if(user){if(!user.isDemo||user.role!==role||![1,demoSeedVersion].includes(priorVersion))throw error(409,'演示账号标识冲突，已保留现有账号，请联系管理员');if(priorVersion===demoSeedVersion)return user;}
  const asOf=new Date();user=user?{...user,demoSeedVersion}:{id,username:id,displayName:role==='buyer'?'买家演示账号 · 只读':'供应商演示账号 · 只读',role,isDemo:true,demoSeedVersion,passwordHash,createdAt:asOf.toISOString()};
  if(priorVersion)await tx.put('users',user);else await tx.insert('users',user);
  const records=seedRecords(user,asOf);for(const row of records)await tx.insert('risk_records',row);
  const audit={id:'AUD-'+randomUUID(),sequence:(root.sequence||0)+1,ownerId:id,isDemo:true,actorId:'system:demo-provision',action:priorVersion?'demo.upgrade':'demo.seed',entityId:id,at:asOf.toISOString(),payload:{source:'estimate',reason:scenarioSourceNote,fromVersion:priorVersion,seedVersion:demoSeedVersion,records},previousHash:root.headHash};audit.hash=digest(audit);
  await tx.insert('risk_audit',audit);await tx.put('risk_locks',{...root,sequence:audit.sequence,headHash:audit.hash});return user;
 });
}

export async function demoBootstrap(store,user,publicProducts){
 const data=await store.get('risk_records','demo:'+user.role+':v'+user.demoSeedVersion+':business');
 if(!data||data.ownerId!==user.id||!data.isDemo)throw error(503,'演示资料暂不可用，请重新进入演示账号');
 return {products:[...publicProducts.filter(p=>!p.isDemo&&p.catalogOnly),...data.products],suppliers:data.suppliers,orders:data.orders,inquiries:data.inquiries,applications:data.applications,demo:{readOnly:true,source:'example',notice:sourceNote,asOf:data.createdAt}};
}

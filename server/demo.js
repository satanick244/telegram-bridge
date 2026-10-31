import {randomBytes,randomUUID} from 'node:crypto';
import {digest,evaluate} from './risk-domain.js';
import {defaultRiskRules} from './risk-schema.js';

export const demoAccountNames=Object.freeze({buyer:'induport_demo_buyer_v1',supplier:'induport_demo_supplier_v1'});
const error=(status,message)=>Object.assign(new Error(message),{status});
const sourceNote='InduPort 功能演示数据；企业、合同、库存、金额均为虚构算例，不代表实际交易、供应或资质。';
const dateAgo=(date,days)=>new Date(date.getTime()-days*86400000).toISOString().slice(0,10);

function seedRecords(user,asOf){
 const ownerId=user.id,base={ownerId,isDemo:true,source:'example',inputMethod:'demo',sourceNote,createdAt:asOf.toISOString()},prefix='demo:'+user.role+':';
 const profiles=[
  {id:prefix+'customer-a',businessKey:'DEMO-CUSTOMER-A',name:'【演示】客户 A · 钢材采购训练',partyType:'customer',country:null,registration:null,financialEvidence:null,performanceEvidence:null,notes:'用于完整金额下的资料缺口与逾期提示；没有真实企业资料。'},
  {id:prefix+'customer-b',businessKey:'DEMO-CUSTOMER-B',name:'【演示】客户 B · 待补资料案例',partyType:'customer',country:null,registration:null,financialEvidence:null,performanceEvidence:null,notes:'展示未知数量、成本与汇率不应按零计算。'},
  {id:prefix+'supplier-a',businessKey:'DEMO-SUPPLIER-A',name:'【演示】供应商 A · 采购成本训练',partyType:'supplier',country:null,registration:null,financialEvidence:null,performanceEvidence:null,notes:'无真实供应能力、库存或认证。'},
 ].map(x=>({...base,...x,kind:'profile',version:1}));
 const tradeBase={...base,kind:'trade',version:1,platformOrderId:null,reserved:false,receivedMinor:0,releasedMinor:0,cancelled:false};
 const trades=[
  {...tradeBase,id:prefix+'contract-a',profileId:profiles[0].id,businessKey:'DEMO-SALE-USD',direction:'sale',currency:'USD',amountMinor:2400000,quantity:40,unit:'吨',term:'FOB',paymentMode:'credit',dueDate:dateAgo(asOf,8),steelUnitCostMinor:330000,steelCurrency:'CNY',steelCostUnit:'吨',freightMinor:800000,freightCurrency:'CNY',freightPayer:'self',freightIncluded:true,fxRate:7.12},
  {...tradeBase,id:prefix+'contract-b',profileId:profiles[1].id,businessKey:'DEMO-MISSING-DATA',direction:'sale',currency:'USD',amountMinor:1200000,quantity:null,unit:'吨',term:null,paymentMode:'credit',dueDate:dateAgo(asOf,2),steelUnitCostMinor:null,steelCurrency:null,steelCostUnit:null,freightMinor:null,freightCurrency:null,freightPayer:null,freightIncluded:null,fxRate:null},
  {...tradeBase,id:prefix+'contract-c',profileId:profiles[2].id,businessKey:'DEMO-PURCHASE-CNY',direction:'purchase',currency:'CNY',amountMinor:13200000,quantity:40000,unit:'千克',term:'EXW',paymentMode:'cash',dueDate:null,steelUnitCostMinor:330000,steelCurrency:'CNY',steelCostUnit:'吨',freightMinor:800000,freightCurrency:'CNY',freightPayer:'self',freightIncluded:false,fxRate:null},
 ];
 const ruleSnapshot={...defaultRiskRules,demoScenario:true};
 const evaluations=trades.map(t=>({...base,id:t.id+':evaluation',kind:'evaluation',tradeId:t.id,...evaluate(t,profiles.find(p=>p.id===t.profileId),ruleSnapshot,null,asOf)}));
 const tickets=[
  {...base,id:prefix+'ticket-overdue',kind:'ticket',tradeId:trades[0].id,title:'【演示】逾期升级 · 非真实催收',severity:'high',status:'in_progress',assigneeId:ownerId,version:1,resolution:'处理示意：核对合同、账龄与对账凭据，未执行真实催收。',evaluationSnapshot:evaluations[0]},
  {...base,id:prefix+'ticket-missing',kind:'ticket',tradeId:trades[1].id,title:'【演示】资料待补齐',severity:'warning',status:'open',assigneeId:ownerId,version:1,evaluationSnapshot:evaluations[1]},
 ];
 // Illustrated arithmetic is deliberately a separate record kind, never credit or ledger.
 const exampleCase={...base,id:prefix+'credit-case',kind:'demo_case',title:'【演示】额度占用与部分收款算例',currency:'USD',illustrativeLimitMinor:10000000,illustrativeReserveMinor:4000000,illustrativeReceiptMinor:1000000,illustrativeOccupiedMinor:3000000,illustrativeAvailableMinor:7000000,steps:['人工批准示例总额度 USD 100,000','示例订单占用 USD 40,000','假设确认收到 USD 10,000，等额核销并释放','剩余占用 USD 30,000，可用 USD 70,000'],note:'纯算例，不存在真实授信、银行收款或额度流水。'};
 const supplier={id:prefix+'business-supplier',ownerId,name:'【演示】供应商 A · 虚构训练企业',en:'DEMO supplier — fictional training case',location:'示例场景 · 非实际所在地',contact:'演示联系人（非真实人员）',verified:false,certifications:'无真实认证资料 · 仅供功能演示',years:null,score:null,isDemo:true,source:'example'};
 const products=[{id:prefix+'business-product',ownerId,name:'【演示】热轧钢卷 · 交易算例',en:'DEMO hot rolled coil — not an offer',category:'钢卷',grade:'演示规格 · 非实际供货',spec:'仅用于界面展示',unit:'吨',price:600,cost:3300,stock:100,moq:10,port:'示例装运港',term:'FOB',supplierId:supplier.id,image:'coil',certifications:'无真实认证资料',featured:false,lead:'演示交期',status:'在售',createdAt:asOf.toISOString(),isDemo:true,source:'example',sourceNote}];
 const order={id:prefix+'business-order',ownerId,productId:products[0].id,productName:products[0].name,supplierId:supplier.id,buyer:'【演示】客户 A · 虚构训练企业',email:'demo@example.invalid',country:'示例目的国',destination:'示例目的港',quantity:40,unit:'吨',unitPrice:600,costCny:3300,exchangeRate:7.12,feeRate:2,total:24000,status:'合同确认',term:'FOB',createdAt:asOf.toISOString(),history:[{status:'待确认',at:asOf.toISOString()},{status:'合同确认',at:asOf.toISOString()}],isDemo:true,source:'example',sourceNote};
 const inquiry={id:prefix+'business-inquiry',ownerId,productId:products[0].id,productName:products[0].name,supplierId:supplier.id,buyer:'【演示】客户 B · 虚构询价',email:'demo@example.invalid',country:'示例目的国',quantity:20,unit:'吨',message:'【演示】询价场景：核对材质、交期、付款条件；不代表真实采购意向。',status:'待报价',createdAt:asOf.toISOString(),isDemo:true,source:'example',sourceNote};
 const business={...base,id:prefix+'business',kind:'demo_business',products,suppliers:[supplier],orders:[order],inquiries:[inquiry],applications:[]};
 return [...profiles,...trades,...evaluations,...tickets,exampleCase,business];
}

export async function getDemoAccount(store,role,hashPassword){
 if(typeof role!=='string'||!Object.hasOwn(demoAccountNames,role))throw error(400,'仅提供买家和供应商演示，不提供管理员演示');
 const id=demoAccountNames[role];
 // Compute hashes outside the transaction; passwords are random, never exposed or needed to sign in.
 const passwordHash=await hashPassword(randomBytes(32).toString('hex'));
 return store.transaction(async tx=>{
  const root=await tx.get('risk_locks','operations');if(!root)throw Error('Risk lock is not initialized');
  let user=await tx.get('users',id);
  if(user){if(!user.isDemo||user.role!==role||user.demoSeedVersion!==1)throw error(409,'演示账号标识冲突，已保留现有账号，请联系管理员');return user;}
  const asOf=new Date();user={id,username:id,displayName:role==='buyer'?'买家演示账号 · 只读':'供应商演示账号 · 只读',role,isDemo:true,demoSeedVersion:1,passwordHash,createdAt:asOf.toISOString()};
  await tx.insert('users',user);
  const records=seedRecords(user,asOf);for(const row of records)await tx.insert('risk_records',row);
  const audit={id:'AUD-'+randomUUID(),sequence:(root.sequence||0)+1,ownerId:id,isDemo:true,actorId:'system:demo-provision',action:'demo.seed',entityId:id,at:asOf.toISOString(),payload:{source:'example',reason:sourceNote,seedVersion:1,records},previousHash:root.headHash};audit.hash=digest(audit);
  await tx.insert('risk_audit',audit);await tx.put('risk_locks',{...root,sequence:audit.sequence,headHash:audit.hash});return user;
 });
}

export async function demoBootstrap(store,user,publicProducts){
 const data=await store.get('risk_records','demo:'+user.role+':business');
 if(!data||data.ownerId!==user.id||!data.isDemo)throw error(503,'演示资料暂不可用，请重新进入演示账号');
 return {products:[...publicProducts.filter(p=>!p.isDemo&&p.catalogOnly),...data.products],suppliers:data.suppliers,orders:data.orders,inquiries:data.inquiries,applications:data.applications,demo:{readOnly:true,source:'example',notice:sourceNote,asOf:data.createdAt}};
}

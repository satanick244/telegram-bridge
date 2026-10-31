import express from 'express';
import {installRisk} from './risk.js';
import {demoBootstrap} from './demo.js';
import {randomUUID} from 'node:crypto';
import {calculateProfit,orderStatuses,validateOrder} from './domain.js';
import {productCategories,categoryImages,units,unitOf} from '../shared/catalog.js';
import {installAuth,publicUser,requireUser,requireAdmin,fail} from './auth.js';
const text=(v,label,max=200)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw fail(400,`${label}不能为空，且长度不得超过 ${max} 字符`);return v.trim()};
const number=(v,label,min=0,max=1e8)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw fail(400,`${label}须在 ${min}–${max} 之间`);return v};
const email=v=>{const s=text(v,'邮箱');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw fail(400,'请输入有效邮箱');return s};
const id=prefix=>prefix+randomUUID().slice(0,8).toUpperCase();
const cleanProduct=(p,user)=>{const {cost,ownerId,...safe}=p;return user&&(user.role==='admin'||ownerId===user.id)?p:safe};
const owns=(user,row)=>!!user&&(user.role==='admin'||row.ownerId===user.id);
export function createApp(store,options={}){
 const app=express();app.set('trust proxy',1);app.disable('x-powered-by');app.use(express.json({limit:'100kb'}));
 installAuth(app,store,options);
 app.get('/api/health',async(req,res)=>{await store.probe();res.json({ok:true,mode:'sourcing',database:store.engine,riskVersion:'steel-risk-v1',demoVersion:'forecast-demo-v2'})});
 app.get('/api/bootstrap',async(req,res)=>{
  const user=req.user;if(user?.isDemo){const products=(await store.all('products')).filter(p=>!p.isSample&&p.catalogOnly&&p.status==='在售').map(p=>cleanProduct(p,user));return res.json({user:publicUser(user),...await demoBootstrap(store,user,products)})}const suppliers=(await store.all('suppliers')).filter(s=>!s.isSample);
  const mySuppliers=new Set(suppliers.filter(s=>owns(user,s)).map(s=>s.id));
  const visible=row=>owns(user,row)||(user&&mySuppliers.has(row.supplierId));
  const result={user:publicUser(user),products:(await store.all('products')).filter(p=>!p.isSample&&(p.status==='在售'||owns(user,p))).map(p=>cleanProduct(p,user)),suppliers:suppliers.map(({contact,ownerId,...s})=>owns(user,{ownerId})?{...s,contact,ownerId}:s),orders:[],inquiries:[],applications:[]};
  for(const bucket of ['orders','inquiries','applications'])if(user)result[bucket]=(await store.all(bucket)).filter(x=>!x.isSample&&(bucket==='applications'?owns(user,x):visible(x))).map(x=>{if(bucket!=='orders'||user.role==='admin'||mySuppliers.has(x.supplierId))return x;const {costCny,...safe}=x;return safe});
  for(const bucket of ['products','orders','inquiries','applications'])result[bucket].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  res.json(result);
 });
 app.post('/api/profit',(req,res)=>{try{res.json(calculateProfit(req.body))}catch(e){throw fail(400,e.message)}});
 app.use('/api',requireUser);
 app.get('/api/admin/backup',requireAdmin,async(req,res)=>{const data=await store.transaction(async tx=>{const tables={};for(const bucket of ['products','suppliers','orders','inquiries','applications','users','risk_records','risk_audit','risk_locks'])tables[bucket]=(await tx.all(bucket)).filter(x=>!x.isSample);return {format:'induport-backup-v1',createdAt:new Date().toISOString(),tables}});res.set('Content-Disposition','attachment; filename="induport.backup.json"');res.json(data)});
 app.post('/api/products',async(req,res)=>{
  const b=req.body;const supplier=await store.get('suppliers',b.supplierId);
  if(!supplier||supplier.isSample)throw fail(400,'请选择有效供应商');
  if(!owns(req.user,supplier))throw fail(403,'只能为自己的供应商档案发布商品');
  const category=text(b.category,'品类');if(!productCategories.includes(category))throw fail(400,'品类无效');
  const stock=number(b.stock,'库存',1,1e7),moq=number(b.moq,'起订量',1,1e7);if(!Number.isSafeInteger(stock)||!Number.isSafeInteger(moq)||moq>stock)throw fail(400,'库存与起订量须为整数，且库存不少于起订量');
  const item={id:randomUUID(),ownerId:supplier.ownerId||req.user.id,name:text(b.name,'商品名称',80),en:text(b.en||b.name,'英文名称',120),category,unit:units.includes(b.unit)?b.unit:unitOf({category}),grade:text(b.grade,'型号或牌号',80),spec:text(b.spec,'规格',150),price:number(b.price,'售价',1,1e6),cost:number(b.cost,'成本',0,1e6),stock,moq,port:text(b.port,'装运港'),term:['FOB','CIF','CFR','EXW'].includes(b.term)?b.term:'FOB',supplierId:b.supplierId,image:categoryImages[category].includes(b.image)?b.image:categoryImages[category][0],certifications:text(b.certifications||'待补充','认证'),lead:text(b.lead||'按合同确认','交期'),status:'在售',createdAt:new Date().toISOString()};
  await store.put('products',item);res.status(201).json(item);
 });
 app.patch('/api/products/:id',async(req,res)=>{const item=await store.get('products',req.params.id);if(!item)throw fail(404,'商品不存在');if(!owns(req.user,item))throw fail(403,'无权修改该商品');if(!['在售','已下架'].includes(req.body.status))throw fail(400,'商品状态无效');res.json(await store.put('products',{...item,status:req.body.status}))});
 app.post('/api/applications',async(req,res)=>{
  const b=req.body,registration=text(b.registration,'统一社会信用代码',18).toUpperCase();if(!/^[0-9A-Z]{18}$/.test(registration))throw fail(400,'统一社会信用代码须为 18 位字母或数字');
  const item={id:id('APP-'),ownerId:req.user.id,company:text(b.company,'企业名称',100),registration,contact:text(b.contact,'联系人',80),email:email(b.email),location:text(b.location,'企业所在地'),category:text(b.category,'主营品类'),capacity:number(b.capacity,'年产能',1,1e9),capacityUnit:units.includes(b.capacityUnit)?b.capacityUnit:'吨',certifications:text(b.certifications||'待补充','认证'),status:'待审核',createdAt:new Date().toISOString()};
  await store.transaction(async tx=>{if((await tx.all('applications')).some(a=>a.registration===registration))throw fail(400,'该企业已提交申请，请勿重复提交');try{await tx.insert('applications',item)}catch(e){if(e.code==='ER_DUP_ENTRY'||[1555,2067].includes(e.errcode))throw fail(400,'该企业已提交申请，请勿重复提交');throw e}});res.status(201).json(item);
 });
 app.patch('/api/applications/:id',requireAdmin,async(req,res)=>{
  const result=await store.transaction(async tx=>{const a=await tx.get('applications',req.params.id);if(!a)throw fail(404,'申请不存在');if(a.status!=='待审核')throw fail(400,'该申请已处理');if(!['已通过','需补充资料'].includes(req.body.status))throw fail(400,'审核状态无效');
   if(req.body.status==='已通过'){await tx.put('suppliers',{id:a.id,ownerId:a.ownerId,name:a.company,en:a.company,location:a.location,contact:a.contact,verified:false,certifications:a.certifications,years:0,score:null});const u=await tx.get('users',a.ownerId);if(u&&u.role!=='admin')await tx.put('users',{...u,role:'supplier'})}
   return tx.put('applications',{...a,status:req.body.status});});res.json(result);
 });
 app.post('/api/orders',async(req,res)=>{
  const b=req.body;
  const item=await store.transaction(async tx=>{const p=await tx.get('products',b.productId);if(!p||p.status!=='在售')throw fail(400,'商品不存在或已下架');let total;try{total=validateOrder(p,b.quantity)}catch(e){throw fail(400,e.message)}
   const row={id:id('IP-'+new Date().toISOString().slice(0,7).replace('-','')+'-'),ownerId:req.user.id,productId:p.id,productName:p.name,supplierId:p.supplierId,buyer:text(b.buyer,'买方企业'),email:email(b.email),country:text(b.country,'目的国'),destination:text(b.destination,'目的港'),quantity:b.quantity,unit:unitOf(p),unitPrice:p.price,costCny:p.cost,exchangeRate:7.12,feeRate:2,total,term:p.term,status:'待确认',createdAt:new Date().toISOString(),history:[{status:'待确认',at:new Date().toISOString()}]};await tx.put('products',{...p,stock:p.stock-b.quantity});await tx.insert('orders',row);return row;
  });const {costCny,...safe}=item;res.status(201).json(req.user.role==='admin'?item:safe);
 });
 app.patch('/api/orders/:id/advance',async(req,res)=>{
  const row=await store.transaction(async tx=>{const item=await tx.get('orders',req.params.id);if(!item||item.isSample)throw fail(404,'订单不存在');const supplier=await tx.get('suppliers',item.supplierId);if(req.user.role!=='admin'&&!owns(req.user,supplier||{}))throw fail(403,'订单履约状态由供应商维护');const index=orderStatuses.indexOf(item.status);if(index<0||index===orderStatuses.length-1)throw fail(400,'订单已完成');const status=orderStatuses[index+1];return tx.put('orders',{...item,status,history:[...(item.history||[]),{status,at:new Date().toISOString()}]});});res.json(row);
 });
 const inquiryInfo=(b,req)=>({ownerId:req.user.id,buyer:text(b.buyer,'公司名称'),email:email(b.email),country:text(b.country,'目的国'),message:text(b.message,'采购要求',2000),status:'待报价',createdAt:new Date().toISOString()});
 app.post('/api/inquiries',async(req,res)=>{const b=req.body,p=await store.get('products',b.productId);if(!p||p.status!=='在售')throw fail(400,'商品不存在或已下架');const quantity=number(b.quantity,'询价数量',p.moq||1,p.catalogOnly?1e7:p.stock);if(!Number.isSafeInteger(quantity))throw fail(400,'询价数量须为整数');const row={...inquiryInfo(b,req),id:id('RFQ-'),productId:p.id,productName:p.name,quantity,unit:unitOf(p),supplierId:p.supplierId};await store.insert('inquiries',row);res.status(201).json(row)});
 app.post('/api/inquiries/batch',async(req,res)=>{
  const b=req.body;if(!Array.isArray(b.items)||!b.items.length||b.items.length>20)throw fail(400,'询价篮须包含 1–20 款商品');if(b.items.some(x=>!x||typeof x.productId!=='string')||new Set(b.items.map(x=>x.productId)).size!==b.items.length)throw fail(400,'请选择商品并合并重复项');const info=inquiryInfo(b,req),groupId=id('RFQ-G-');
  const rows=await store.transaction(async tx=>{const rows=[];for(const x of b.items){const p=await tx.get('products',x.productId);if(!p||p.status!=='在售')throw fail(400,'询价商品不存在或已下架');const quantity=number(x.quantity,'采购量',p.moq||1,1e7);if(!Number.isSafeInteger(quantity))throw fail(400,'采购量须为整数');rows.push({...info,id:id('RFQ-'),groupId,productId:p.id,productName:p.name,supplierId:p.supplierId,quantity,unit:unitOf(p)})}for(const row of rows)await tx.insert('inquiries',row);return rows});res.status(201).json({id:groupId,items:rows,status:'待报价',createdAt:info.createdAt});
 });
 app.post('/api/inquiries/custom',async(req,res)=>{const b=req.body,quantity=number(b.quantity,'采购量',1,1e7);if(!Number.isSafeInteger(quantity))throw fail(400,'采购量须为整数');if(!units.includes(b.unit))throw fail(400,'计量单位无效');const row={...inquiryInfo(b,req),id:id('RFQ-'),productId:null,custom:true,productName:text(b.productName,'采购商品',120),category:text(b.category,'采购品类',80),quantity,unit:b.unit};await store.insert('inquiries',row);res.status(201).json(row)});
 app.patch('/api/inquiries/:id/quote',async(req,res)=>{const row=await store.transaction(async tx=>{const item=await tx.get('inquiries',req.params.id);if(!item||item.isSample)throw fail(404,'询价单不存在');const s=item.supplierId?await tx.get('suppliers',item.supplierId):null;if(req.user.role!=='admin'&&!owns(req.user,s||{}))throw fail(403,'只能回复发给自己企业的询价');if(item.status!=='待报价')throw fail(400,'该询价已报价');return tx.put('inquiries',{...item,quotedPrice:number(req.body.price,'报价',1,1e6),status:'已报价',quotedAt:new Date().toISOString()})});res.json(row)});
 installRisk(app,store);
 app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在'}));
 app.use((err,req,res,next)=>{const status=err.status||(err.type==='entity.parse.failed'?400:500);if(status===500)console.error('API operation failed:',err.code||err.name);res.status(status).json({error:status===500?'服务器处理失败，请稍后重试':err.message})});
 return app;
}

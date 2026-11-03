import {requireUser,requireAdmin,fail} from './auth.js';
import {riskTransaction,accessible,audit,rules} from './risk-core.js';
import {text,choice,number,minor,day,key,digest,realSource} from './risk-domain.js';
import {reviewState,controlId,monitorPolicy} from './risk-monitor-domain.js';
const now=()=>new Date().toISOString();
const get=(tx,id)=>tx.get('risk_records',id),put=(tx,row)=>tx.put('risk_records',row);
function fields(body,allowed){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw fail(400,'包含未知字段，不能指定所属账号、核验人或审批结果');}
async function realRecord(tx,user,id,kind){const row=await accessible(tx,user,id,kind);if(row.isDemo||!realSource(row.source))throw fail(400,'仅支持真实录入或导入的业务资料');return row;}
async function requestRecord(tx,user,kind,owner,businessKey,input){
 const id=key(kind,owner,businessKey),inputHash=digest(input),old=await get(tx,id);
 if(old){if(old.inputHash!==inputHash)throw fail(409,'业务唯一键已用于不同内容');return old;}
 const row={...input,id,kind,ownerId:owner,businessKey,inputHash,requestedBy:user.id,status:'pending',createdAt:now()};
 await tx.insert('risk_records',row);await audit(tx,user,owner,kind+'.request',id,row);return row;
}
async function ensureCase(tx,actor,profile,reasons,blocking,rows){
 const cases=rows.filter(x=>x.kind==='review_case'&&x.profileId===profile.id&&!x.isDemo),open=cases.find(x=>x.status==='open');
 if(open){const triggers=[...new Set([...open.triggers,...reasons])];if(digest(triggers)!==digest(open.triggers)||blocking&&!open.blocking||open.profileVersion!==profile.version){const updated={...open,triggers,blocking:open.blocking||blocking,version:open.version+1,profileVersion:profile.version,profileSnapshot:profile};await put(tx,updated);await audit(tx,actor,profile.ownerId,'review.escalate',open.id,{before:open,after:updated});return updated;}return open;}
 const sequence=Math.max(0,...cases.map(x=>x.sequence))+1,id=key('review',profile.ownerId,[profile.id,sequence]);
 const row={id,kind:'review_case',ownerId:profile.ownerId,profileId:profile.id,source:profile.source,sourceNote:profile.sourceNote,sequence,status:'open',version:1,blocking,triggers:reasons,requestedBy:actor.id,assigneeId:profile.ownerId,profileSnapshot:profile,profileVersion:profile.version,policySnapshot:monitorPolicy,rulesSnapshot:await rules(tx),createdAt:now()};
 await tx.insert('risk_records',row);await audit(tx,actor,profile.ownerId,'review.open',id,row);return row;
}
export async function scanReviews(tx,actor,scope){
 const rows=await tx.all('risk_records'),policy=await rules(tx);let created=0;
 for(const p of rows.filter(x=>x.kind==='profile'&&!x.isDemo&&realSource(x.source)&&(!scope||x.ownerId===scope))){
  const state=reviewState(rows,p,policy);const reasons=state.triggers.filter(x=>x!=='客户复审处理中'&&x!=='复审限制新增赊销');
  // A restricted conclusion stays restricted until an explicit follow-up; avoid a new case every scan.
  if(!reasons.length)continue;
  const row=await ensureCase(tx,actor,p,reasons,state.hard.some(x=>!['客户复审处理中','复审限制新增赊销'].includes(x)),rows);if(!state.openCase){created++;rows.push(row);}
 }
 return {created,scannedAt:now(),policy:monitorPolicy};
}
export const runReviewMonitor=store=>riskTransaction(store,tx=>scanReviews(tx,{id:'system:risk-monitor'},null));
export function installRiskMonitor(app,store){
 const run=fn=>riskTransaction(store,fn);
 app.post('/api/risk/reviews/scan',requireUser,async(req,res)=>res.json(await run(tx=>scanReviews(tx,req.user,req.user.role==='admin'?null:req.user.id))));
 app.post('/api/risk/reviews',requireUser,async(req,res)=>res.status(201).json(await run(async tx=>{
  fields(req.body,['profileId','reason']);const p=await realRecord(tx,req.user,req.body.profileId,'profile');
  return ensureCase(tx,req.user,p,[text(req.body.reason,'复审触发原因',1000)],true,await tx.all('risk_records'));
 })));
 app.patch('/api/risk/reviews/:id',requireUser,async(req,res)=>res.json(await run(async tx=>{
  const b=req.body;fields(b,['version','assigneeId','reason']);const row=await accessible(tx,req.user,req.params.id,'review_case');
  if(row.status!=='open'||row.version!==b.version)throw fail(409,'复审已变化或已结束，请刷新');
  const assignee=await tx.get('users',text(b.assigneeId,'复审负责人',100));if(!assignee||assignee.isDemo||assignee.id!==row.ownerId&&assignee.role!=='admin')throw fail(400,'负责人须为所属账号或平台管理员');
  const result={...row,assigneeId:assignee.id,version:row.version+1};await put(tx,result);await audit(tx,req.user,row.ownerId,'review.assign',row.id,{before:row,after:result,reason:text(b.reason,'分派理由',1000)});return result;
 })));
 app.post('/api/risk/reviews/:id/decide',requireUser,requireAdmin,async(req,res)=>res.json(await run(async tx=>{
  const b=req.body;fields(b,['version','conclusion','reason','evidenceRef','nextReviewDate','registrationVerified','financialVerified','performanceVerified']);
  const review=await accessible(tx,req.user,req.params.id,'review_case'),p=await realRecord(tx,req.user,review.profileId,'profile');
  if(review.status!=='open')throw fail(409,'复审已完成，请新建复审，不可覆盖历史');
  if(review.version!==b.version)throw fail(409,'复审任务已变化，请刷新');
  if(review.requestedBy===req.user.id||p.ownerId===req.user.id||(p.updatedBy||p.createdBy)===req.user.id)throw fail(403,'资料提供或复审申请人与独立核验人必须分离');
  if(review.profileVersion!==p.version)throw fail(409,'任务中的档案版本已变化，请刷新并重新扫描');
  const conclusion=choice(b.conclusion,['cleared','restricted'],'复审结论'),reason=text(b.reason,'复审理由',1000),evidenceRef=text(b.evidenceRef,'独立核验依据',1000),nextReviewDate=day(b.nextReviewDate);
  if(!nextReviewDate||nextReviewDate<=now().slice(0,10))throw fail(400,'下次复审日须晚于今天');
  const verification=Object.fromEntries(['registration','financial','performance'].map(k=>[k,b[k+'Verified']===true]));
  if(conclusion==='cleared'){
   if(!p.registration||!p.country||!p.financialEvidence||!p.performanceEvidence||Object.values(verification).some(v=>!v))throw fail(400,'须补齐并独立核验主体、财务及履约依据，不能将填写视为核验');
   const state=reviewState(await tx.all('risk_records'),p,await rules(tx));if(state.overdueDays>=(await rules(tx)).overdueEscalationDays)throw fail(409,'严重逾期尚未消除，不能解除新增赊销限制');
  }
  const result={...review,status:'completed',version:review.version+1,conclusion,reason,evidenceRef,nextReviewDate,verification,profileVersion:p.version,profileSnapshot:p,decidedBy:req.user.id,decidedAt:now(),rulesSnapshot:await rules(tx)};
  await put(tx,result);await audit(tx,req.user,p.ownerId,'review.complete',review.id,result);return result;
 })));
 app.post('/api/risk/trade-controls',requireUser,async(req,res)=>res.status(201).json(await run(async tx=>{
  const b=req.body;fields(b,['tradeId','businessKey','version','reason','sourceNote','lockedQuantity','lockEvidence','inventoryQuantity','positionType','batchNumber','grade','specification','warehouse','titleEvidence','qualityEvidence','marketUnitPrice','marketPriceAsOf','supplierPrepayment','prepaymentEvidence','minPrepaymentPct','securityMode']);
  const t=await realRecord(tx,req.user,b.tradeId,'trade');if(!(t.quantity>0)||!t.unit||!t.currency||t.amountMinor===null||t.cancelled)throw fail(400,'须先明确未取消合同的金额、币种、数量和单位');
  const lockedQuantity=number(b.lockedQuantity,'已锁价数量',0,t.quantity),inventoryQuantity=number(b.inventoryQuantity,'库存数量',0,t.quantity),marketUnitPriceMinor=minor(b.marketUnitPrice,'市场单位价格'),marketPriceAsOf=day(b.marketPriceAsOf),supplierPrepaymentMinor=minor(b.supplierPrepayment,'供应商预付款');
  if(marketUnitPriceMinor!==null&&(!marketPriceAsOf||marketPriceAsOf>now().slice(0,10)||!t.steelCurrency||!t.steelCostUnit))throw fail(400,'行情须有不晚于今天的日期及合同成本币种、单位');
  if(supplierPrepaymentMinor!==null&&(t.direction!=='purchase'||supplierPrepaymentMinor>t.amountMinor))throw fail(400,'供应商预付款仅适用于采购，且不能超过合同本金');
  const positionType=choice(b.positionType,['back_to_back','unsold_inventory'],'业务头寸');if(positionType==='unsold_inventory'&&t.direction!=='purchase')throw fail(400,'未售库存头寸须关联采购合同');
  const payload={lockedQuantity,inventoryQuantity,positionType,marketUnitPriceMinor,marketPriceAsOf,supplierPrepaymentMinor,minPrepaymentPct:number(b.minPrepaymentPct,'最低预付比例',0,100),securityMode:choice(b.securityMode,['unknown','none','instruments'],'保障安排'),source:t.source,sourceNote:text(b.sourceNote,'资料来源说明',1000)};
  for(const k of ['lockEvidence','batchNumber','grade','specification','warehouse','titleEvidence','qualityEvidence','prepaymentEvidence'])payload[k]=text(b[k],k,1000,true);
  if(inventoryQuantity>0&&(!payload.batchNumber||!payload.warehouse))throw fail(400,'登记正数库存须明确批次及仓储位置，避免重复分配');
  if(lockedQuantity>0&&!payload.lockEvidence)throw fail(400,'已锁价数量须有采购锁价依据');
  if(supplierPrepaymentMinor>0&&!payload.prepaymentEvidence)throw fail(400,'供应商预付款须有支付核验依据');
  if(positionType==='unsold_inventory'&&inventoryQuantity===null)throw fail(400,'库存头寸须明确库存数量');
  const expectedVersion=number(b.version,'台账版本',0,1e9,false);if(!Number.isInteger(expectedVersion))throw fail(400,'台账版本无效');
  return requestRecord(tx,req.user,'control_change',t.ownerId,text(b.businessKey,'业务唯一键',100),{tradeId:t.id,expectedVersion,payload,reason:text(b.reason,'变更理由',1000),tradeSnapshot:t});
 })));
 app.post('/api/risk/securities',requireUser,async(req,res)=>res.status(201).json(await run(async tx=>{
  const b=req.body;fields(b,['tradeId','businessKey','version','instrumentType','reference','issuer','amount','currency','coveragePct','validFrom','validUntil','evidenceRef','sourceNote','reason','status']);
  const t=await realRecord(tx,req.user,b.tradeId,'trade');const currency=choice(b.currency,['USD','CNY'],'保障币种');if(currency!==t.currency)throw fail(400,'保障须与合同同币种，不支持未经核验的跨币种折算');
  const reference=text(b.reference,'保障唯一编号',150).normalize('NFKC').toUpperCase(),targetId=key('security',t.ownerId,reference),amountMinor=minor(b.amount,'保障金额',false),validFrom=day(b.validFrom),validUntil=day(b.validUntil);
  if(!(amountMinor>0)||!validFrom||!validUntil||validUntil<validFrom)throw fail(400,'须明确正数保障金额及有效期间');
  const expectedVersion=number(b.version,'保障版本',0,1e9,false);if(!Number.isInteger(expectedVersion))throw fail(400,'保障版本无效');
  const payload={reference,instrumentType:choice(b.instrumentType,['bank_guarantee','credit_insurance','corporate_guarantee'],'保障类型'),issuer:text(b.issuer,'出具方',150),amountMinor,currency,coveragePct:number(b.coveragePct,'覆盖比例',0,100,false),validFrom,validUntil,evidenceRef:text(b.evidenceRef,'保障及可执行性依据',1000),source:t.source,sourceNote:text(b.sourceNote,'资料来源说明',1000),status:choice(b.status,['active','withdrawn'],'保障状态')};
  return requestRecord(tx,req.user,'security_change',t.ownerId,text(b.businessKey,'业务唯一键',100),{tradeId:t.id,profileId:t.profileId,targetId,expectedVersion,payload,reason:text(b.reason,'申请理由',1000),tradeSnapshot:t});
 })));
 for(const kind of ['control_change','security_change'])app.post('/api/risk/'+(kind==='control_change'?'trade-controls':'securities')+'/:id/decide',requireUser,requireAdmin,async(req,res)=>res.json(await run(async tx=>{
  const b=req.body;fields(b,['decision','reason','evidenceRef','verified']);const request=await accessible(tx,req.user,req.params.id,kind),decision=choice(b.decision,['approved','rejected'],'审批决定'),reason=text(b.reason,'独立复核理由',1000);
  if(request.status!=='pending'){if(request.status===decision&&request.decisionReason===reason)return request;throw fail(409,'申请已处理，不可覆盖历史');}
  if(request.requestedBy===req.user.id)throw fail(403,'录入人与独立核验人必须分离');
  const t=await realRecord(tx,req.user,request.tradeId,'trade');let applied=null;
  if(decision==='approved'){
   if(b.verified!==true)throw fail(400,'须明确完成独立核验');
   if(t.cancelled||t.version!==request.tradeSnapshot.version)throw fail(409,'合同已变化，请重新申请');
   const id=kind==='control_change'?controlId(t):request.targetId,old=await get(tx,id);
   if((old?.version||0)!==request.expectedVersion)throw fail(409,'台账版本已变化，请重新申请');
   if(old&&old.tradeId!==t.id)throw fail(409,'同一保障编号不能跨合同重复分配，请先核实保障范围');
   if(kind==='control_change'&&request.payload.securityMode==='none'&&(await tx.all('risk_records')).some(x=>x.kind==='security_instrument'&&x.tradeId===t.id&&x.status==='active'))throw fail(409,'仍有生效保障记录，不能声明无保障');
   if(kind==='control_change'&&request.payload.inventoryQuantity>0){
    const normalize=v=>v?.normalize('NFKC').trim().toUpperCase();
    const duplicate=(await tx.all('risk_records')).some(x=>x.kind==='trade_control'&&x.ownerId===t.ownerId&&x.tradeId!==t.id&&x.inventoryQuantity>0&&normalize(x.batchNumber)===normalize(request.payload.batchNumber)&&normalize(x.warehouse)===normalize(request.payload.warehouse));
    if(duplicate)throw fail(409,'同批次同仓储库存已绑定其他合同，须先独立核验并解除原分配');
   }
   applied={...request.payload,id,kind:kind==='control_change'?'trade_control':'security_instrument',ownerId:t.ownerId,profileId:t.profileId,tradeId:t.id,version:(old?.version||0)+1,unit:t.unit,verified:true,verifiedBy:req.user.id,verificationEvidence:text(b.evidenceRef,'独立核验依据',1000),verifiedAt:now(),approvalId:request.id};await put(tx,applied);
  }
  const result={...request,status:decision,decisionReason:reason,decidedBy:req.user.id,decidedAt:now(),appliedSnapshot:applied};await put(tx,result);await audit(tx,req.user,t.ownerId,kind+'.'+decision,request.id,result);return result;
 })));
}

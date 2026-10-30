import {randomUUID} from 'node:crypto';
import {fail,requireUser,requireAdmin} from './auth.js';
import {unitOf} from '../shared/catalog.js';
import {defaultRiskRules} from './risk-schema.js';
import {profileInput,tradeInput,profileFields,tradeFields,text,choice,number,minor,realSource,evaluate,key,digest,parseRows,currencies} from './risk-domain.js';
const now=()=>new Date().toISOString();
const can=(user,row)=>row&&(user.role==='admin'||row.ownerId===user.id);
const uuid=prefix=>prefix+'-'+randomUUID();
const read=(tx,id)=>tx.get('risk_records',id);
const put=(tx,row)=>tx.put('risk_records',row);
const insert=(tx,row)=>tx.insert('risk_records',row);
async function accessible(tx,user,id,kind){const row=await read(tx,id);if(!can(user,row)||row.kind!==kind)throw fail(404,'记录不存在或无权访问');return row}
export const riskTransaction=(store,fn)=>store.transaction(async tx=>{const lock=await tx.get('risk_locks','operations');if(!lock)throw Error('Risk lock is not initialized');return fn(tx,lock)});
async function audit(tx,user,ownerId,action,entityId,payload){
 const root=await tx.get('risk_locks','operations');const row={id:uuid('AUD'),sequence:(root.sequence||0)+1,ownerId,actorId:user.id,action,entityId,at:now(),payload,previousHash:root.headHash};row.hash=digest(row);
 await tx.insert('risk_audit',row);await tx.put('risk_locks',{...root,sequence:row.sequence,headHash:row.hash});
}
async function rules(tx){return await read(tx,'rules')||{...defaultRiskRules}}
const accountId=(p,c)=>key('credit',p,c);
async function evaluation(tx,trade){return evaluate(trade,await read(tx,trade.profileId),await rules(tx),await read(tx,accountId(trade.profileId,trade.currency)))}
async function saveEvaluation(tx,user,trade){const result=await evaluation(tx,trade);const row={id:uuid('EVAL'),kind:'evaluation',ownerId:trade.ownerId,tradeId:trade.id,...result};await insert(tx,row);await audit(tx,user,trade.ownerId,'evaluation',row.id,row);return row}
async function makeProfile(tx,user,b,inputMethod='manual'){const input=profileInput(b),id=key('profile',user.id,input.businessKey);const existing=await read(tx,id);if(existing){if(existing.inputHash!==digest(input))throw fail(409,'档案业务唯一键已用于不同内容');return existing}const row={...input,id,kind:'profile',inputMethod,ownerId:user.id,version:1,inputHash:digest(input),createdAt:now()};await insert(tx,row);await audit(tx,user,user.id,'profile.create',id,row);return row}
async function makeTrade(tx,user,b,inputMethod='manual'){
 const input=tradeInput(b),profile=await accessible(tx,user,input.profileId,'profile');
 if((input.direction==='sale'&&profile.partyType!=='customer')||(input.direction==='purchase'&&profile.partyType!=='supplier'))throw fail(400,'销售合同须关联客户，采购合同须关联供应商');
 const id=key('trade',profile.ownerId,input.businessKey),existing=await read(tx,id);
 if(existing){if(existing.inputHash!==digest(input))throw fail(409,'订单业务唯一键已用于不同内容');return existing}
 if(input.platformOrderId){const order=await tx.get('orders',input.platformOrderId);if(!order||order.isSample||order.ownerId!==profile.ownerId)throw fail(404,'仅能关联本账号的真实平台采购订单');if(input.direction!=='purchase'||input.currency!=='USD'||input.amountMinor!==Math.round(order.total*100)||input.quantity!==order.quantity||input.unit!==unitOf(order)||input.term!==order.term)throw fail(400,'关联订单的方向、币种、金额、数量、单位和条款必须与平台订单一致');const rows=await tx.all('risk_records');if(rows.some(x=>x.kind==='trade'&&x.platformOrderId===input.platformOrderId))throw fail(409,'该平台订单已有风控档案，不能重复敞口');}
 const row={...input,id,kind:'trade',inputMethod,ownerId:profile.ownerId,version:1,reserved:false,receivedMinor:0,releasedMinor:0,createdAt:now(),inputHash:digest(input)};
 await insert(tx,row);await audit(tx,user,row.ownerId,'trade.create',id,row);await saveEvaluation(tx,user,row);return row;
}
async function createApproval(tx,user,b,type){
 const profile=type==='credit'?await accessible(tx,user,b.profileId,'profile'):null;
 const trade=type!=='credit'?await accessible(tx,user,b.tradeId,'trade'):null;
 const party=profile||await read(tx,trade.profileId),ownerId=party.ownerId;
 if(!realSource(party.source)||trade&&!realSource(trade.source))throw fail(400,'预估或示例不可授信、占额或收款核销');
 const input={type,profileId:party.id,tradeId:trade?.id||null,businessKey:text(b.businessKey,'操作业务唯一键',100),reason:text(b.reason,'申请理由',1000),acknowledgeMissing:b.acknowledgeMissing===true};
 if(type==='credit'){if(party.partyType!=='customer')throw fail(400,'赊销授信仅适用于客户');input.currency=choice(b.currency,currencies,'授信币种');input.amountMinor=minor(b.amount,'授信额度',false);const account=await read(tx,accountId(party.id,input.currency));input.accountVersion=account?.version||0;}
 else{input.currency=trade.currency;if(type==='receipt'){input.amountMinor=minor(b.amount,'收款金额',false);if(input.amountMinor<=0)throw fail(400,'收款金额须大于零');input.source=choice(b.source,['manual','import'],'收款来源');input.sourceNote=text(b.sourceNote,'收款凭据/来源',1000);} }
 // Idempotency does not depend on the current mutable account version.
 const fingerprint={...input};delete fingerprint.accountVersion;
 const id=key(type==='receipt'?'receipt':'approval',ownerId,[type,input.businessKey]),existing=await read(tx,id);
 if(existing){if(existing.inputHash!==digest(fingerprint))throw fail(409,'操作业务唯一键已用于不同内容');return existing}
 if(trade){if(type==='reserve'&&(trade.reserved||trade.cancelled))throw fail(409,'订单已占额或已取消');if(type==='receipt'&&(!trade.reserved||trade.cancelled)||type==='release'&&trade.cancelled)throw fail(409,'须先完成订单占额审批，且订单未取消');}
 const row={...input,id,kind:'approval',ownerId,requestedBy:user.id,status:'pending',createdAt:now(),inputHash:digest(fingerprint),rulesSnapshot:await rules(tx),profileSnapshot:party,evaluationSnapshot:trade?await evaluation(tx,trade):null};
 await insert(tx,row);await audit(tx,user,ownerId,'approval.request',id,row);return row;
}
async function decide(tx,user,approval,b){
 const decision=choice(b.decision,['approved','rejected'],'审批决定'),reason=text(b.reason,'审批理由',1000);
 if(approval.status!=='pending'){if(approval.status===decision&&approval.decisionReason===reason)return approval;throw fail(409,'申请已处理，不可覆盖历史审批');}
 let decisionEvaluation=null;
 if(decision==='approved'){
  const party=await read(tx,approval.profileId);
  if(!realSource(party.source))throw fail(400,'预估/示例档案不可进入真实额度账');
  if(approval.type==='credit'){
   if((!party.registration||!party.country||!party.financialEvidence||!party.performanceEvidence)&&!approval.acknowledgeMissing)throw fail(400,'资料待补齐；申请须明确确认缺失资料，并由管理员说明审批理由');
   const id=accountId(party.id,approval.currency),account=await read(tx,id);
   if((account?.version||0)!==approval.accountVersion)throw fail(409,'授信已变更，请重新提交申请');
   if(approval.amountMinor<(account?.occupiedMinor||0))throw fail(409,'授信额度不能低于当前占用');
   await put(tx,{id,kind:'credit',profileId:party.id,ownerId:party.ownerId,currency:approval.currency,limitMinor:approval.amountMinor,occupiedMinor:account?.occupiedMinor||0,version:(account?.version||0)+1,approvalId:approval.id});
  }else{
   const trade=await read(tx,approval.tradeId),evalResult=await evaluation(tx,trade);decisionEvaluation=evalResult;
   const id=accountId(party.id,trade.currency),account=await read(tx,id);
   if(approval.type==='reserve'){
    if(trade.reserved||trade.cancelled)throw fail(409,'订单已占额或取消');
    if(trade.direction!=='sale'||trade.paymentMode!=='credit'||!trade.dueDate||!trade.currency||!(trade.amountMinor>0))throw fail(400,'占额需要销售赊销合同、到期日及明确的正数金额和币种');
    if(evalResult.missing.length&&!approval.acknowledgeMissing)throw fail(400,'资料待补齐，须明确确认缺失资料后申请人工审批');
    if(!account||trade.amountMinor>account.limitMinor-account.occupiedMinor)throw fail(409,'未获批足够授信，不能占用额度');
    await put(tx,{...account,occupiedMinor:account.occupiedMinor+trade.amountMinor});
    await put(tx,{...trade,reserved:true,reservedAt:now(),reserveApprovalId:approval.id});
    await insert(tx,{id:key('ledger',trade.ownerId,approval.id),kind:'ledger',ownerId:trade.ownerId,profileId:party.id,tradeId:trade.id,currency:trade.currency,amountMinor:trade.amountMinor,action:'reserve',approvalId:approval.id,createdAt:now()});
   }else{
    if(approval.type==='release'&&!trade.reserved&&!trade.cancelled){
     await put(tx,{...trade,cancelled:true,version:trade.version+1});
    }else{
    if(!trade.reserved||trade.cancelled||!account)throw fail(409,'订单未占额或已经取消');
    const outstanding=trade.amountMinor-trade.receivedMinor-trade.releasedMinor;
    const amount=approval.type==='receipt'?approval.amountMinor:outstanding;
    if(amount<=0||amount>outstanding||amount>account.occupiedMinor)throw fail(409,'收款/释放金额超出未结清敞口，或订单已经结清');
    await put(tx,{...account,occupiedMinor:account.occupiedMinor-amount});
    await put(tx,{...trade,receivedMinor:trade.receivedMinor+(approval.type==='receipt'?amount:0),releasedMinor:trade.releasedMinor+(approval.type==='release'?amount:0),cancelled:approval.type==='release',version:trade.version+1});
    await insert(tx,{id:key('ledger',trade.ownerId,approval.id),kind:'ledger',ownerId:trade.ownerId,profileId:party.id,tradeId:trade.id,currency:trade.currency,amountMinor:-amount,action:approval.type,source:approval.source||trade.source,sourceNote:approval.sourceNote||approval.reason,approvalId:approval.id,createdAt:now()});
   }
  }
 }
 }
 const result={...approval,status:decision,decidedBy:user.id,decidedAt:now(),decisionReason:reason,decisionRulesSnapshot:await rules(tx),decisionEvaluation,decisionProfileSnapshot:await read(tx,approval.profileId)};await put(tx,result);await audit(tx,user,approval.ownerId,'approval.'+decision,approval.id,result);return result;
}
export function installRisk(app,store){
 const run=fn=>riskTransaction(store,fn);
 app.get('/api/risk',requireUser,async(req,res)=>res.json(await run(async tx=>{
  const rows=(await tx.all('risk_records')).filter(x=>can(req.user,x));const trades=rows.filter(x=>x.kind==='trade');const assessments=[];for(const t of trades)assessments.push({tradeId:t.id,...await evaluation(tx,t)});
  return {rules:await rules(tx),records:rows,assessments,audit:(await tx.all('risk_audit')).filter(x=>can(req.user,x)||x.ownerId==='*').sort((a,b)=>b.sequence-a.sequence),assignees:(await tx.all('users')).filter(u=>u.id===req.user.id||u.role==='admin').map(u=>({id:u.id,displayName:u.displayName}))};
 })));
 app.post('/api/risk/profiles',requireUser,async(req,res)=>res.status(201).json(await run(tx=>makeProfile(tx,req.user,req.body))));
 app.patch('/api/risk/profiles/:id',requireUser,async(req,res)=>res.json(await run(async tx=>{
  const row=await accessible(tx,req.user,req.params.id,'profile');if(req.body.version!==row.version)throw fail(409,'资料已更新，请刷新');const input=profileInput({...row,...req.body});if(input.source!==row.source||input.businessKey!==row.businessKey||input.partyType!==row.partyType)throw fail(400,'来源、业务唯一键和类型不可修改，请新建档案');
  const reason=text(req.body.reason,'修改理由',1000);const result={...row,...input,version:row.version+1,updatedAt:now()};await put(tx,result);await audit(tx,req.user,row.ownerId,'profile.update',row.id,{before:row,after:result,reason});return result;
 })));
 app.post('/api/risk/trades',requireUser,async(req,res)=>res.status(201).json(await run(tx=>makeTrade(tx,req.user,req.body))));
 app.post('/api/risk/trades/:id/evaluate',requireUser,async(req,res)=>res.status(201).json(await run(async tx=>saveEvaluation(tx,req.user,await accessible(tx,req.user,req.params.id,'trade')))));
 for(const type of ['credit','reserve','receipt','release'])app.post('/api/risk/approvals/'+type,requireUser,async(req,res)=>res.status(201).json(await run(tx=>createApproval(tx,req.user,req.body,type))));
 app.post('/api/risk/approvals/:id/decide',requireUser,requireAdmin,async(req,res)=>res.json(await run(async tx=>decide(tx,req.user,await accessible(tx,req.user,req.params.id,'approval'),req.body))));
 app.put('/api/risk/rules',requireUser,requireAdmin,async(req,res)=>res.json(await run(async tx=>{
  const old=await rules(tx),b=req.body;if(b.version!==old.version)throw fail(409,'规则已更新，请刷新');
  const input={};for(const k of ['overdueWarningDays','overdueEscalationDays']){input[k]=number(b[k],k,1,365,false);if(!Number.isInteger(input[k]))throw fail(400,'预警天数须为整数')}
  if(input.overdueEscalationDays<input.overdueWarningDays)throw fail(400,'升级天数不能早于预警');
  for(const k of ['steelShockPct','fxShockPct','freightShockPct'])input[k]=number(b[k],k,0,99,false);
  const result={...old,...input,version:old.version+1,updatedAt:now(),updatedBy:req.user.id};await put(tx,result);await audit(tx,req.user,'*','rules.update','rules',{before:old,after:result,reason:text(b.reason,'规则调整理由',1000)});return result;
 })));
 app.post('/api/risk/alerts/scan',requireUser,async(req,res)=>res.json(await run(async tx=>{
  const trades=(await tx.all('risk_records')).filter(x=>x.kind==='trade'&&can(req.user,x));let created=0;
  for(const trade of trades){if(trade.cancelled)continue;const e=await evaluation(tx,trade);const codes=[...(e.missing.length?['资料待补齐']:[]),...e.warnings];
   for(const code of codes){const id=key('ticket',trade.ownerId,[trade.id,code]);if(await read(tx,id))continue;const ticket={id,kind:'ticket',ownerId:trade.ownerId,tradeId:trade.id,source:trade.source,title:code,severity:code==='逾期升级'?'high':'warning',status:'open',assigneeId:trade.ownerId,version:1,createdAt:now(),evaluationSnapshot:e};await insert(tx,ticket);await audit(tx,req.user,trade.ownerId,'ticket.create',id,ticket);created++;}
  }return {created};
 })));
 app.patch('/api/risk/tickets/:id',requireUser,async(req,res)=>res.json(await run(async tx=>{
  const row=await accessible(tx,req.user,req.params.id,'ticket'),b=req.body;if(b.version!==row.version)throw fail(409,'工单已更新，请刷新');
  const status=choice(b.status,['open','in_progress','resolved'],'处理状态');const assignee=await tx.get('users',text(b.assigneeId,'负责人',100));if(!assignee||(assignee.id!==row.ownerId&&assignee.role!=='admin'))throw fail(400,'负责人须为资料所属账号或平台管理员');
  const reason=text(b.reason,'处理说明',1000),result={...row,status,assigneeId:assignee.id,version:row.version+1,updatedAt:now(),resolution:reason};await put(tx,result);await audit(tx,req.user,row.ownerId,'ticket.update',row.id,{before:row,after:result,reason});return result;
 })));
 app.post('/api/risk/import',requireUser,async(req,res)=>res.status(201).json(await run(async tx=>{
  const b=req.body,kind=choice(b.kind,['profiles','trades'],'导入类型'),batchKey=text(b.batchKey,'导入批次唯一键',100),sourceNote=text(b.sourceNote,'文件来源说明',1000),dataClass=choice(b.dataClass,['real','estimate','example'],'导入数据性质');
  const fingerprint=digest({kind,format:b.format,content:b.content,sourceNote,dataClass}),id=key('import',req.user.id,batchKey),existing=await read(tx,id);if(existing){if(existing.fingerprint!==fingerprint)throw fail(409,'批次唯一键已用于不同文件');return existing}
  const rows=parseRows(b.format,b.content);if(!rows.length||rows.length>200)throw fail(400,'每批须为 1–200 条记录');const results=[];
  for(let i=0;i<rows.length;i++){const row=rows[i];try{if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!(kind==='profiles'?profileFields:tradeFields).includes(k)))throw fail(400,'包含未知字段，不能指定所属账号、审批或账本字段');const input={...row,source:dataClass==='real'?'import':dataClass,sourceNote:`${sourceNote} · 批次 ${batchKey} · 行 ${i+1}`};results.push((await (kind==='profiles'?makeProfile:makeTrade)(tx,req.user,input,'import')).id)}catch(e){if(e.status)throw fail(e.status,`第 ${i+1} 行：${e.message}`);throw e}}
  const result={id,kind:'import',ownerId:req.user.id,batchKey,fingerprint,sourceNote,dataClass,recordIds:results,createdAt:now()};await insert(tx,result);await audit(tx,req.user,req.user.id,'import',id,result);return result;
 })));
 app.get('/api/risk/audit/verify',requireUser,requireAdmin,async(req,res)=>res.json(await run(async(tx,root)=>{
  // Read the root again: run wrappers do not pass lock arguments through.
  root=await tx.get('risk_locks','operations');const rows=(await tx.all('risk_audit')).sort((a,b)=>a.sequence-b.sequence);let previousHash=null,sequence=0;for(const row of rows){const {hash,...body}=row;if(row.previousHash!==previousHash||row.sequence!==++sequence||digest(body)!==hash)return {ok:false,sequence};previousHash=hash;}
  return {ok:previousHash===root.headHash&&sequence===(root.sequence||0),count:sequence,headHash:previousHash,scope:'应用追加式哈希链；不替代数据库权限隔离和外部备份'};
 })));
}

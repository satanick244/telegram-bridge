import {fail,requireUser,requireAdmin} from './auth.js';
import {riskTransaction,accessible,audit,rules,accountId,creditProblems,workflowPolicy} from './risk-core.js';
import {text,choice,minor,day,digest,key,realSource,evaluate} from './risk-domain.js';
const now=()=>new Date().toISOString();
const today=()=>now().slice(0,10);
const get=(tx,id)=>tx.get('risk_records',id);
const put=(tx,row)=>tx.put('risk_records',row);
const insert=(tx,row)=>tx.insert('risk_records',row);
const can=(u,r)=>r&&!r.isDemo&&(u.role==='admin'||r.ownerId===u.id);
const outstanding=t=>t.cancelled?0:t.amountMinor-t.receivedMinor-t.releasedMinor;
const positive=v=>{const n=minor(v,'金额',false);if(n<=0)throw fail(400,'金额须大于零');return n};
function realDate(value,label){const d=day(value);if(!d||d>today())throw fail(400,label+'须为不晚于今天的有效日期');return d}
async function realTrade(tx,u,id){const t=await accessible(tx,u,id,'trade');const p=await get(tx,t.profileId);if(t.isDemo||p.isDemo||!realSource(t.source)||!realSource(p.source)||t.direction!=='sale'||t.cancelled||!(t.amountMinor>0)||!t.currency)throw fail(400,'仅支持未取消、金额币种明确的真实销售合同');return t}
function uniqueInput(existing,fingerprint){if(existing&&existing.inputHash!==fingerprint)throw fail(409,'业务唯一键已用于不同内容');return existing}
async function operation(tx,u,owner,kind,businessKey,input,build){const id=key(kind,owner,businessKey),inputHash=digest(input),old=uniqueInput(await get(tx,id),inputHash);if(old)return old;const row={...await build(),id,kind,controlVersion:2,ownerId:owner,businessKey,inputHash,createdAt:now()};await insert(tx,row);await audit(tx,u,owner,kind+'.create',id,row);return row}

export async function shipmentGate(tx,trade,order){
 const profile=await get(tx,trade.profileId),policy=await rules(tx),account=await get(tx,accountId(trade.profileId,trade.currency)),rows=await tx.all('risk_records');
 const invoices=rows.filter(x=>x.kind==='receivable'&&x.tradeId===trade.id&&x.status!=='voided');const billed=invoices.reduce((n,x)=>n+x.amountMinor,0),paid=invoices.reduce((n,x)=>n+x.paidMinor,0);
 const hard=[],soft=[];
 if(trade.isDemo||profile?.isDemo||!realSource(trade.source)||!realSource(profile?.source))hard.push('仅允许真实合同和客户档案');
 if(trade.direction!=='sale'||trade.cancelled||!(trade.amountMinor>0)||!trade.currency)hard.push('销售合同已取消或金额币种无效');
 if(!profile?.registration||!profile?.country)hard.push('客户主体身份资料未齐备');
 if(!profile?.financialEvidence||!profile?.performanceEvidence)soft.push('客户财务或履约依据待复核');
 if(!order||order.isSample||!trade.platformOrderId||trade.platformOrderId!==order.id)hard.push('未关联真实平台销售订单');
 if(order&&profile?.platformAccountId!==order.ownerId)hard.push('客户档案未绑定该订单买家账号');
 if(order&&(['运输中','已完成'].includes(order.status)))hard.push('该订单已发货');
 if(order&&(trade.amountMinor!==Math.round(order.total*100)||trade.currency!=='USD'||trade.quantity!==order.quantity||trade.unit!==(order.unit||'吨')||trade.term!==order.term))hard.push('风控合同与交易订单金额、币种、数量、单位或条款不一致');
 if(trade.receivedMinor>paid)hard.push('历史核销尚未与应收逐笔对齐，须办理期初核销对账');
 if(billed!==trade.amountMinor)hard.push('已登记应收金额须覆盖本单完整本金');
 if(trade.paymentMode==='credit'){
  if(outstanding(trade)>0){hard.push(...creditProblems(account,trade,new Date(),profile));if(!trade.reserved)hard.push('赊销合同尚未完成占额审批');}else if(account?.frozen)hard.push('客户授信已冻结');
  if(outstanding(trade)>0&&account&&account.occupiedMinor<outstanding(trade))hard.push('当前占额不足以覆盖未结清本金');
 }else if(trade.paymentMode==='cash'){if(paid<trade.amountMinor)hard.push('现款合同尚未由已确认到账资金全额核销');}
 else hard.push('付款方式未明确');
 const uncoveredOther=rows.filter(x=>x.kind==='trade'&&!x.isDemo&&x.id!==trade.id&&x.ownerId===trade.ownerId&&x.profileId===trade.profileId&&x.currency===trade.currency&&x.direction==='sale'&&x.paymentMode==='credit'&&!x.cancelled&&!x.reserved&&outstanding(x)>0&&rows.some(i=>i.kind==='receivable'&&i.tradeId===x.id&&i.status!=='voided'));if(uncoveredOther.length)hard.push('同客户存在尚未获授信覆盖的其他应收');
 const overdueInvoices=rows.filter(x=>x.kind==='receivable'&&!x.isDemo&&x.ownerId===trade.ownerId&&x.profileId===trade.profileId&&x.currency===trade.currency&&x.status!=='voided'&&x.amountMinor>x.paidMinor&&x.dueDate<today());
 // Unbilled legacy contracts remain visible in overdue checks without adding their principal twice.
 const overdueContracts=rows.filter(x=>x.kind==='trade'&&!x.isDemo&&x.ownerId===trade.ownerId&&x.profileId===trade.profileId&&x.currency===trade.currency&&x.paymentMode==='credit'&&!x.cancelled&&outstanding(x)>0&&x.dueDate&&x.dueDate<today());
 const overdueMaxDays=Math.max(0,...[...overdueInvoices,...overdueContracts].map(x=>Math.floor((Date.parse(today()+'T00:00:00Z')-Date.parse(x.dueDate+'T00:00:00Z'))/86400000)));if(overdueMaxDays)soft.push('该客户存在逾期余额，最长'+overdueMaxDays+'天');
 const assessment=evaluate(trade,profile,policy,account);if(assessment.missing.length)soft.push('测算输入待补齐：'+assessment.missing.join('、'));if(assessment.stressedMarginMinor!==null&&assessment.stressedMarginMinor<0)soft.push('压力测算出现亏损');
 const allocations=rows.filter(x=>x.kind==='flow_approval'&&x.type==='allocation'&&x.status==='approved'&&!x.reversedBy&&x.items.some(i=>invoices.some(v=>v.id===i.invoiceId)));
 const state={workflowPolicy,overdueMaxDays,trade:{id:trade.id,version:trade.version,reserved:trade.reserved,cancelled:!!trade.cancelled,receivedMinor:trade.receivedMinor,releasedMinor:trade.releasedMinor},profile,account:account||null,policy,invoices:invoices.map(x=>({id:x.id,amountMinor:x.amountMinor,paidMinor:x.paidMinor,version:x.version,status:x.status})).sort((a,b)=>a.id.localeCompare(b.id)),allocations:allocations.map(x=>x.id).sort(),order:order?{id:order.id,status:order.status,total:order.total,quantity:order.quantity,unit:order.unit||'吨',term:order.term}:null,uncoveredOther:uncoveredOther.map(x=>x.id).sort(),overdueInvoices:overdueInvoices.map(x=>x.id).sort(),overdueContracts:overdueContracts.map(x=>x.id).sort()};
 return {hard:[...new Set(hard)],soft:[...new Set(soft)],billedMinor:billed,paidMinor:paid,remainingMinor:outstanding(trade),currency:trade.currency,state,fingerprint:digest(state),checkedAt:now(),assessment};
}
export async function consumeShipmentApproval(tx,user,order,approvalId){
 if(!approvalId)throw fail(409,'进入运输中前须选择有效的独立发货审批');
 const approval=await accessible(tx,user,approvalId,'flow_approval');if(approval.type!=='shipment'||approval.status!=='approved'||approval.orderId!==order.id||approval.consumedAt)throw fail(409,'发货审批无效、已使用或不属于该订单');
 if(approval.expiresAt<=now())throw fail(409,'发货审批已到期，请重新申请');
 const trade=await accessible(tx,user,approval.tradeId,'trade'),supplier=await tx.get('suppliers',order.supplierId);if(supplier?.ownerId!==trade.ownerId)throw fail(409,'发货合同所属账号必须为该订单供应商');
 const gate=await shipmentGate(tx,trade,order);if(gate.hard.length)throw fail(409,gate.hard.join('；'));if(gate.fingerprint!==approval.gateSnapshot.fingerprint)throw fail(409,'余额、规则、档案或订单已变化，须重新申请发货复核');if(gate.soft.length&&!approval.exceptionApproved)throw fail(409,'存在未处理风险提示，须重新复核');
 const result={...approval,consumedAt:now(),consumedBy:user.id};await put(tx,result);await audit(tx,user,trade.ownerId,'shipment.consume',approval.id,{approvalId:approval.id,orderId:order.id,gateSnapshot:gate});return result;
}

async function applyAllocation(tx,u,a){
 const receipt=await accessible(tx,u,a.receiptId,'cash_receipt');if(receipt.status!=='confirmed')throw fail(409,'到账记录未经独立确认或已作废');
 const total=a.items.reduce((n,x)=>n+x.amountMinor,0);if(total>receipt.amountMinor-receipt.allocatedMinor)throw fail(409,'超过该笔到账的未分配金额');
 const byTrade=new Map();
 for(const item of a.items){const invoice=await accessible(tx,u,item.invoiceId,'receivable');if(invoice.status==='voided'||invoice.profileId!==receipt.profileId||invoice.currency!==receipt.currency||invoice.ownerId!==receipt.ownerId||item.amountMinor>invoice.amountMinor-invoice.paidMinor)throw fail(409,'应收归属、客户、币种不符或分配超额');const trade=await realTrade(tx,u,invoice.tradeId);if(item.amountMinor>outstanding(trade))throw fail(409,'核销超出合同剩余本金');await put(tx,{...invoice,paidMinor:invoice.paidMinor+item.amountMinor,status:invoice.paidMinor+item.amountMinor===invoice.amountMinor?'settled':'open',version:invoice.version+1});
  const current=await get(tx,trade.id);await put(tx,{...current,receivedMinor:current.receivedMinor+item.amountMinor,version:current.version+1});byTrade.set(trade.id,(byTrade.get(trade.id)||0)+item.amountMinor);
 }
 for(const [tradeId,amountMinor] of byTrade){const trade=await get(tx,tradeId);if(trade.reserved){const account=await get(tx,accountId(trade.profileId,trade.currency));if(!account||account.occupiedMinor<amountMinor)throw fail(409,'额度余额不一致，请先对账');await put(tx,{...account,occupiedMinor:account.occupiedMinor-amountMinor});await insert(tx,{id:key('ledger',a.id,tradeId),kind:'ledger',ownerId:trade.ownerId,profileId:trade.profileId,tradeId,currency:trade.currency,amountMinor:-amountMinor,action:'allocation',approvalId:a.id,receiptId:receipt.id,createdAt:now()});}}
 await put(tx,{...receipt,allocatedMinor:receipt.allocatedMinor+total,version:receipt.version+1});
 await insert(tx,{id:key('cash_ledger',a.ownerId,a.id),kind:'cash_ledger',ownerId:a.ownerId,receiptId:receipt.id,approvalId:a.id,action:'allocation',amountMinor:total,currency:receipt.currency,items:a.items,createdAt:now()});
}
async function reverseAllocation(tx,u,a){
 const original=await accessible(tx,u,a.allocationId,'flow_approval');if(!['allocation','opening_match'].includes(original.type)||original.status!=='approved'||original.reversedBy)throw fail(409,'仅能完整冲销尚未冲销的已批准核销批次');if(original.type==='opening_match'){for(const i of original.items){const inv=await accessible(tx,u,i.invoiceId,'receivable');if(inv.paidMinor<i.amountMinor)throw fail(409,'期初核销余额不一致');await put(tx,{...inv,paidMinor:inv.paidMinor-i.amountMinor,status:'open',version:inv.version+1});}await put(tx,{...original,reversedBy:a.id});await insert(tx,{id:key('cash_ledger',a.ownerId,a.id),kind:'cash_ledger',ownerId:a.ownerId,approvalId:a.id,action:'legacy_opening_unmatch',amountMinor:-original.items.reduce((n,x)=>n+x.amountMinor,0),currency:original.currency,originalApprovalId:original.id,createdAt:now()});return;}const receipt=await accessible(tx,u,original.receiptId,'cash_receipt');if(receipt.status!=='confirmed')throw fail(409,'原到账状态异常，须先对账');
 const byTrade=new Map();let total=0;
 for(const item of original.items){const invoice=await accessible(tx,u,item.invoiceId,'receivable'),trade=await accessible(tx,u,invoice.tradeId,'trade');if(invoice.paidMinor<item.amountMinor||trade.receivedMinor<item.amountMinor)throw fail(409,'原核销余额不一致');await put(tx,{...invoice,paidMinor:invoice.paidMinor-item.amountMinor,status:'open',version:invoice.version+1});await put(tx,{...trade,receivedMinor:trade.receivedMinor-item.amountMinor,version:trade.version+1});byTrade.set(trade.id,(byTrade.get(trade.id)||0)+item.amountMinor);total+=item.amountMinor;}
 if(receipt.allocatedMinor<total)throw fail(409,'到账分配余额不一致');
 for(const [tradeId,amountMinor] of byTrade){const trade=await get(tx,tradeId);if(trade.reserved){const account=await get(tx,accountId(trade.profileId,trade.currency));if(!account)throw fail(409,'原授信账不存在');const occupiedMinor=account.occupiedMinor+amountMinor;await put(tx,{...account,occupiedMinor,frozen:account.frozen||occupiedMinor>account.limitMinor});await insert(tx,{id:key('ledger',a.id,tradeId),kind:'ledger',ownerId:trade.ownerId,profileId:trade.profileId,tradeId,currency:trade.currency,amountMinor,action:'allocation_reversal',approvalId:a.id,originalApprovalId:original.id,createdAt:now()});}}
 await put(tx,{...receipt,allocatedMinor:receipt.allocatedMinor-total,version:receipt.version+1});await put(tx,{...original,reversedBy:a.id});await insert(tx,{id:key('cash_ledger',a.ownerId,a.id),kind:'cash_ledger',ownerId:a.ownerId,receiptId:receipt.id,approvalId:a.id,action:'allocation_reversal',amountMinor:-total,currency:receipt.currency,originalApprovalId:original.id,createdAt:now()});
}
async function shipped(tx,trade){if(!trade.platformOrderId)return false;const order=await tx.get('orders',trade.platformOrderId);return ['运输中','已完成'].includes(order?.status)}
export function installRiskFlow(app,store){
 const run=fn=>riskTransaction(store,fn);
 app.get('/api/risk/flow',requireUser,async(req,res)=>res.json(await run(async tx=>{
  const rows=(await tx.all('risk_records')).filter(x=>can(req.user,x));const trades=rows.filter(x=>x.kind==='trade'&&x.direction==='sale'&&realSource(x.source)&&rows.some(p=>p.id===x.profileId&&realSource(p.source)));const exposures=[];
  for(const t of trades){const invoices=rows.filter(x=>x.kind==='receivable'&&x.tradeId===t.id&&x.status!=='voided');const billed=invoices.reduce((n,x)=>n+x.amountMinor,0),paid=invoices.reduce((n,x)=>n+x.paidMinor,0);exposures.push({tradeId:t.id,profileId:t.profileId,currency:t.currency,contractMinor:t.amountMinor,unbilledMinor:t.cancelled?0:t.amountMinor===null?null:t.amountMinor-billed,receivableMinor:billed-paid,allocatedMinor:paid,uncoveredMinor:!t.reserved?outstanding(t):0,legacyReceivedMinor:Math.max(0,t.receivedMinor-paid),occupiedMinor:t.reserved?outstanding(t):0,stage:t.cancelled?'已取消':await shipped(tx,t)?'已发货':'发货前承诺',note:'未开票承诺转为应收不新增占额；成本和压力损失不重复加入本金'});}
  return {exposures,receipts:rows.filter(x=>x.kind==='cash_receipt'),invoices:rows.filter(x=>x.kind==='receivable').map(x=>({...x,remainingMinor:x.status==='voided'?0:x.amountMinor-x.paidMinor,overdueDays:x.status!=='voided'&&x.amountMinor>x.paidMinor?Math.max(0,Math.floor((Date.parse(today()+'T00:00:00Z')-Date.parse(x.dueDate+'T00:00:00Z'))/86400000)):0})),approvals:rows.filter(x=>x.kind==='flow_approval'),cashLedger:rows.filter(x=>x.kind==='cash_ledger')};
 })));
 app.post('/api/risk/receivables',requireUser,async(req,res)=>res.status(201).json(await run(async tx=>{
  const b=req.body,t=await realTrade(tx,req.user,b.tradeId);const invoiceNumber=text(b.invoiceNumber,'应收/发票编号',100).normalize('NFKC').toUpperCase(),amountMinor=positive(b.amount),issuedDate=realDate(b.issuedDate,'开票日期'),dueDate=day(b.dueDate);if(!dueDate||dueDate<issuedDate)throw fail(400,'到期日须不早于开票日期');
  const input={tradeId:t.id,invoiceNumber,amountMinor,issuedDate,dueDate,evidenceRef:text(b.evidenceRef,'发票/应收依据索引',1000)};
  return operation(tx,req.user,t.ownerId,'receivable',invoiceNumber,input,async()=>{const all=await tx.all('risk_records'),billed=all.filter(x=>x.kind==='receivable'&&x.tradeId===t.id&&x.status!=='voided').reduce((n,x)=>n+x.amountMinor,0);if(billed+amountMinor>t.amountMinor)throw fail(409,'应收登记总额不能超过合同本金');return {...input,profileId:t.profileId,currency:t.currency,paidMinor:0,status:'open',version:1,source:'manual',createdBy:req.user.id}});
 })));
 app.post('/api/risk/cash-receipts',requireUser,async(req,res)=>res.status(201).json(await run(async tx=>{
  const b=req.body,p=await accessible(tx,req.user,b.profileId,'profile');if(p.partyType!=='customer'||!realSource(p.source)||p.isDemo)throw fail(400,'到账记录须关联真实客户');
  const bankAccountRef=text(b.bankAccountRef,'本方收款账户别名',100).normalize('NFKC').toUpperCase(),bankReference=text(b.bankReference,'银行唯一流水号',150).normalize('NFKC').toUpperCase();const input={profileId:p.id,bankAccountRef,bankReference,amountMinor:positive(b.amount),currency:choice(b.currency,['USD','CNY'],'到账币种'),receivedDate:realDate(b.receivedDate,'到账日期'),payerName:text(b.payerName,'付款方名称',150),evidenceRef:text(b.evidenceRef,'到账凭据索引',1000),source:choice(b.source,['manual','import'],'来源')};
  return operation(tx,req.user,p.ownerId,'cash_receipt',[bankAccountRef,bankReference],input,async()=>({...input,status:'pending',allocatedMinor:0,version:1,recordedBy:req.user.id}));
 })));
 app.post('/api/risk/cash-receipts/:id/confirm',requireUser,requireAdmin,async(req,res)=>res.json(await run(async tx=>{
  const receipt=await accessible(tx,req.user,req.params.id,'cash_receipt'),b=req.body,reason=text(b.reason,'到账确认理由',1000),evidenceRef=text(b.evidenceRef,'独立核验凭据索引',1000);if(receipt.recordedBy===req.user.id)throw fail(403,'到账录入人与确认人必须分离');if(b.fundsVerified!==true)throw fail(400,'须明确确认资金已到账，并核对付款主体和币种');
  if(receipt.status==='confirmed'){if(receipt.confirmationReason===reason&&receipt.confirmationEvidence===evidenceRef)return receipt;throw fail(409,'到账确认记录不可覆盖');}if(receipt.status!=='pending')throw fail(409,'该到账记录不可确认');
  const result={...receipt,status:'confirmed',confirmedBy:req.user.id,confirmedAt:now(),confirmationReason:reason,confirmationEvidence:evidenceRef,version:receipt.version+1};await put(tx,result);await audit(tx,req.user,receipt.ownerId,'cash_receipt.confirm',receipt.id,result);return result;
 })));
 for(const type of ['allocation','opening_match','reversal','receipt_void','invoice_void','shipment'])app.post('/api/risk/flow-approvals/'+type,requireUser,async(req,res)=>res.status(201).json(await run(async tx=>{
  const b=req.body,input={type,reason:text(b.reason,'申请理由',1000)};let ownerId;
  if(type==='opening_match'){const t=await realTrade(tx,req.user,b.tradeId);if(!t.reserved)throw fail(409,'期初对账仅适用于已占额的历史赊销合同');input.tradeId=t.id;ownerId=t.ownerId;input.evidenceRef=text(b.evidenceRef,'历史核销对账依据',1000);if(!Array.isArray(b.items)||!b.items.length||b.items.length>50)throw fail(400,'每批须为1–50笔应收');input.items=b.items.map(x=>({invoiceId:text(x.invoiceId,'应收编号',191),amountMinor:positive(x.amount)}));if(new Set(input.items.map(x=>x.invoiceId)).size!==input.items.length)throw fail(400,'请合并重复应收');for(const i of input.items){const inv=await accessible(tx,req.user,i.invoiceId,'receivable');if(inv.tradeId!==t.id)throw fail(400,'期初对账须关联同一合同');}}else if(type==='allocation'){
   const receipt=await accessible(tx,req.user,b.receiptId,'cash_receipt');if(receipt.status!=='confirmed')throw fail(409,'请先完成到账独立确认');input.receiptId=receipt.id;ownerId=receipt.ownerId;
   if(!Array.isArray(b.items)||!b.items.length||b.items.length>50)throw fail(400,'每批须分配到1–50笔应收');input.items=b.items.map(x=>({invoiceId:text(x.invoiceId,'应收编号',191),amountMinor:positive(x.amount)}));if(new Set(input.items.map(x=>x.invoiceId)).size!==input.items.length)throw fail(400,'同一应收请合并分配金额');
   for(const item of input.items){const inv=await accessible(tx,req.user,item.invoiceId,'receivable');if(inv.ownerId!==ownerId||inv.profileId!==receipt.profileId||inv.currency!==receipt.currency)throw fail(400,'不允许跨账号、客户或币种核销');}
  }else if(type==='reversal'){const a=await accessible(tx,req.user,b.allocationId,'flow_approval');if(!['allocation','opening_match'].includes(a.type)||a.status!=='approved'||a.reversedBy)throw fail(409,'原核销批次不可冲销');input.allocationId=a.id;ownerId=a.ownerId;}
  else if(type==='receipt_void'){const r=await accessible(tx,req.user,b.receiptId,'cash_receipt');input.receiptId=r.id;ownerId=r.ownerId;}
  else if(type==='invoice_void'){const i=await accessible(tx,req.user,b.invoiceId,'receivable');input.invoiceId=i.id;ownerId=i.ownerId;}
  else{const t=await realTrade(tx,req.user,b.tradeId),order=t.platformOrderId?await tx.get('orders',t.platformOrderId):null;if(!order||order.status!=='待装运')throw fail(409,'须关联处于待装运状态的真实销售订单');input.tradeId=t.id;input.orderId=order.id;ownerId=t.ownerId;input.contractRef=text(b.contractRef,'合同确认凭据',1000);input.titleRef=text(b.titleRef,'货权/放货凭据',1000);input.qualityRef=text(b.qualityRef,'质检与装运资料依据',1000);input.requestGate=await shipmentGate(tx,t,order);}
  const businessKey=text(b.businessKey,'业务唯一键',100),fingerprint={...input};delete fingerprint.requestGate;
  return operation(tx,req.user,ownerId,'flow_approval',[type,businessKey],fingerprint,async()=>({...input,requestedBy:req.user.id,status:'pending',rulesSnapshot:await rules(tx)}));
 })));
 app.post('/api/risk/flow-approvals/:id/decide',requireUser,requireAdmin,async(req,res)=>res.json(await run(async tx=>{
  const a=await accessible(tx,req.user,req.params.id,'flow_approval'),b=req.body,decision=choice(b.decision,['approved','rejected'],'审批决定'),reason=text(b.reason,'审批理由',1000);
  if(a.status!=='pending'){if(a.status===decision&&a.decisionReason===reason)return a;throw fail(409,'审批已处理，不可覆盖');}if(a.requestedBy===req.user.id)throw fail(403,'申请人与审批人必须分离');
  let extra={};
  if(decision==='approved'){
   if(a.type==='opening_match'){const t=await realTrade(tx,req.user,a.tradeId),rows=await tx.all('risk_records');const invoices=rows.filter(x=>x.kind==='receivable'&&x.tradeId===t.id&&x.status!=='voided'),paid=invoices.reduce((n,x)=>n+x.paidMinor,0),total=a.items.reduce((n,x)=>n+x.amountMinor,0);if(!t.reserved||total>t.receivedMinor-paid)throw fail(409,'对账金额超过历史未关联核销');for(const i of a.items){const inv=await accessible(tx,req.user,i.invoiceId,'receivable');if(inv.tradeId!==t.id||inv.status==='voided'||i.amountMinor>inv.amountMinor-inv.paidMinor)throw fail(409,'期初应收余额不符');await put(tx,{...inv,paidMinor:inv.paidMinor+i.amountMinor,status:inv.paidMinor+i.amountMinor===inv.amountMinor?'settled':'open',version:inv.version+1});}await insert(tx,{id:key('cash_ledger',a.ownerId,a.id),kind:'cash_ledger',ownerId:a.ownerId,approvalId:a.id,action:'legacy_opening_match',amountMinor:total,currency:t.currency,items:a.items,createdAt:now()});extra.currency=t.currency;}else if(a.type==='allocation')await applyAllocation(tx,req.user,a);
   else if(a.type==='reversal')await reverseAllocation(tx,req.user,a);
   else if(a.type==='receipt_void'){const r=await accessible(tx,req.user,a.receiptId,'cash_receipt');if(r.allocatedMinor!==0||r.status==='voided')throw fail(409,'须先完整冲销分配，到账记录才能作废');await put(tx,{...r,status:'voided',voidApprovalId:a.id,version:r.version+1});}
   else if(a.type==='invoice_void'){const i=await accessible(tx,req.user,a.invoiceId,'receivable'),t=await accessible(tx,req.user,i.tradeId,'trade');if(i.paidMinor!==0||i.status==='voided'||await shipped(tx,t))throw fail(409,'已收款或已发货应收不能直接作废，须办理退货/贷项流程');await put(tx,{...i,status:'voided',voidApprovalId:a.id,version:i.version+1});}
   else{
    const t=await realTrade(tx,req.user,a.tradeId),order=await tx.get('orders',a.orderId);if(order?.status!=='待装运')throw fail(409,'订单已不处于待装运状态');
    const gate=await shipmentGate(tx,t,order);if(gate.hard.length)throw fail(409,gate.hard.join('；'));
    if(b.counterpartyVerified!==true||b.titleVerified!==true||b.qualityVerified!==true)throw fail(400,'须分别核验客户主体、货权和质检装运依据');
    const exceptionApproved=b.exceptionApproved===true;if(gate.soft.length&&!exceptionApproved)throw fail(409,'存在风险提示，须明确例外审批并记录补偿措施：'+gate.soft.join('；'));
    extra={gateSnapshot:gate,exceptionApproved,exceptionReason:exceptionApproved?text(b.exceptionReason,'例外依据',1000):null,compensatingControls:exceptionApproved?text(b.compensatingControls,'补偿控制措施',1000):null,verificationEvidence:text(b.verificationEvidence,'审批核验依据',1000),expiresAt:new Date(Date.now()+workflowPolicy.shipmentValidityHours*3600000).toISOString()};
   }
  }
  const result={...a,...extra,status:decision,decidedBy:req.user.id,decidedAt:now(),decisionReason:reason,decisionRulesSnapshot:await rules(tx),decisionWorkflowPolicy:workflowPolicy};await put(tx,result);await audit(tx,req.user,a.ownerId,'flow_approval.'+decision,a.id,result);return result;
 })));
 app.post('/api/risk/credits/:id/freeze',requireUser,requireAdmin,async(req,res)=>res.json(await run(async tx=>{const a=await accessible(tx,req.user,req.params.id,'credit'),reason=text(req.body.reason,'冻结理由',1000);const result={...a,frozen:true,freezeReason:reason,frozenAt:now(),version:a.version+1};await put(tx,result);await audit(tx,req.user,a.ownerId,'credit.freeze',a.id,{before:a,after:result,reason});return result;})));
 app.get('/api/orders/:id/risk-release',requireUser,async(req,res)=>res.json(await run(async tx=>{const order=await tx.get('orders',req.params.id),supplier=order?await tx.get('suppliers',order.supplierId):null;if(!order||order.isSample||req.user.role!=='admin'&&supplier?.ownerId!==req.user.id)throw fail(404,'订单不存在或无权访问供应商发货依据');const rows=await tx.all('risk_records'),trade=rows.find(x=>x.kind==='trade'&&!x.isDemo&&!x.cancelled&&x.direction==='sale'&&x.platformOrderId===order.id&&x.ownerId===supplier?.ownerId);if(!trade)return {gate:null,approvals:[],message:'请在风控工作台以供应商账号关联本单销售合同'};const gate=await shipmentGate(tx,trade,order);return {tradeId:trade.id,gate,approvals:rows.filter(x=>x.kind==='flow_approval'&&x.type==='shipment'&&x.tradeId===trade.id&&x.status==='approved'&&!x.consumedAt&&x.expiresAt>now()).map(x=>({id:x.id,requestReference:Array.isArray(x.businessKey)?x.businessKey[1]:x.businessKey,expiresAt:x.expiresAt,decidedBy:x.decidedBy,valid:x.gateSnapshot.fingerprint===gate.fingerprint}))};})));
}

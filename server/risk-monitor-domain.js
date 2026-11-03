import {creditProblems} from './risk-core.js';
import {realSource} from './risk-domain.js';
export const monitorPolicy=Object.freeze({version:1,scanIntervalMinutes:15,initialReview:'manual-approval-warning',securityReleasesCredit:false});
export const dayOf=date=>date.toISOString().slice(0,10);
const elapsed=(today,date)=>Math.max(0,Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000));
const balance=t=>t.cancelled?0:t.amountMinor==null?null:t.amountMinor-(t.receivedMinor||0)-(t.releasedMinor||0);
export function reviewState(rows,profile,rules,now=new Date()){
 const today=dayOf(now),cases=rows.filter(x=>x.kind==='review_case'&&x.profileId===profile.id&&!x.isDemo);
 const closed=cases.filter(x=>x.status==='completed').sort((a,b)=>b.sequence-a.sequence),last=closed[0]||null;
 const open=cases.find(x=>x.status==='open')||null;
 const contracts=rows.filter(x=>x.kind==='trade'&&x.profileId===profile.id&&!x.isDemo&&realSource(x.source)&&x.direction==='sale'&&x.paymentMode==='credit'&&!x.cancelled);
 const invoices=rows.filter(x=>x.kind==='receivable'&&x.profileId===profile.id&&!x.isDemo&&x.status!=='voided');
 const overdueDays=Math.max(0,...contracts.filter(x=>balance(x)>0&&x.dueDate).map(x=>elapsed(today,x.dueDate)),...invoices.filter(x=>x.amountMinor>x.paidMinor).map(x=>elapsed(today,x.dueDate)));
 const triggers=[],hard=[];
 if(!last)triggers.push('首次复审待建立');
 if(last?.conclusion==='restricted')hard.push('复审限制新增赊销');
 if(last&&last.profileVersion!==profile.version)hard.push('档案变更须重新复审');
 if(last?.nextReviewDate<today)hard.push('定期复审已到期');
 if(overdueDays>=rules.overdueEscalationDays)hard.push('严重逾期须复审，暂停新增赊销');
 if(open?.blocking)hard.push('客户复审处理中');
 triggers.push(...hard);
 return {profileId:profile.id,status:hard.length?'restricted':last?'current':'missing',label:hard.length?'需复审 · 限制新增赊销':last?'复审有效':'复审待建立',hard:[...new Set(hard)],triggers:[...new Set(triggers)],overdueDays,lastReview:last,openCase:open,nextReviewDate:last?.nextReviewDate||null,verification:last?.verification||null,policy:monitorPolicy};
}
export const controlId=t=>'trade-control:'+t.id;
export function tradeControls(rows,t){return rows.find(x=>x.id===controlId(t))||null}
export function securityPosition(rows,trade,control,now=new Date()){
 const exposure=trade.isDemo&&trade.forecast?(trade.direction==='purchase'?trade.forecast.prepaymentMinor:trade.amountMinor-trade.forecast.receivedMinor):trade.direction==='purchase'?control?.supplierPrepaymentMinor??null:balance(trade),today=dayOf(now);
 const instruments=rows.filter(x=>x.kind==='security_instrument'&&x.tradeId===trade.id&&!x.isDemo);
 const details=instruments.map(x=>{const eligible=x.status==='active'&&x.verified&&realSource(x.source)&&x.currency===trade.currency&&x.validFrom<=today&&x.validUntil>=today&&(!trade.dueDate||x.validUntil>=trade.dueDate);return {...x,eligible,eligibleMinor:exposure===null?null:eligible?Math.min(x.amountMinor,Math.floor(exposure*x.coveragePct/100)):0}});
 const known=control?.securityMode==='none'||details.length>0;
 const securedMinor=known&&exposure!==null?Math.min(exposure,details.reduce((s,x)=>s+x.eligibleMinor,0)):null;
 return {currency:trade.currency,exposureMinor:exposure,securedMinor,unsecuredMinor:securedMinor===null?null:exposure-securedMinor,details,known,automaticCreditOffset:false};
}
const dimension=(state,label,items=[])=>({state,label,items:[...new Set(items)]});
export function riskDimensions(trade,profile,evaluation,rows,rules,now=new Date()){
 if(trade.isDemo){
  const e=evaluation,f=e.forecast,purchase=trade.direction==='purchase';
  return {credit:dimension(purchase?'na':f.overLimitMinor>0?'high':'watch',purchase?'采购不占客户额度':f.overLimitMinor>0?'授信容量不足':'按额度与账期复核'),profit:dimension(purchase?'watch':e.stressedMarginMinor===null?'missing':e.stressedMarginMinor<0?'high':e.stressedMarginMinor===0?'watch':'normal',purchase?'采购成本测算':e.stressedMarginMinor<0?'压力后预计亏损':e.stressedMarginMinor===0?'压力后毛差为零':'压力后毛差为正'),fulfillment:dimension(e.overdueDays>0?'high':'watch',e.overdueDays?'逾期 '+e.overdueDays+' 天':'按合同条件复核'),documents:dimension('watch','主体、财务与履约资料待复核')};
 }
 const review=reviewState(rows,profile,rules,now),control=tradeControls(rows,trade),credit=rows.find(x=>x.kind==='credit'&&x.profileId===profile.id&&x.currency===trade.currency);
 const creditIssues=trade.direction==='sale'&&trade.paymentMode==='credit'&&balance(trade)>0?[...creditProblems(credit,trade,now,profile),...review.hard]:[];
 if(credit&&trade.direction==='sale'&&!trade.reserved&&balance(trade)>credit.limitMinor-credit.occupiedMinor)creditIssues.push('可用授信不足');
 const pending=rows.some(x=>['control_change','security_change'].includes(x.kind)&&x.tradeId===trade.id&&x.status==='pending');
 const fulfillment=[];if(review.overdueDays)fulfillment.push('客户最长逾期 '+review.overdueDays+' 天');if(pending)fulfillment.push('实货或保障台账变更待复核');if(control?.inventoryQuantity!==null&&control?.inventoryQuantity!==undefined&&control.inventoryQuantity<trade.quantity)fulfillment.push('登记库存数量不足整单装运');
 if(control?.minPrepaymentPct!==null&&control?.minPrepaymentPct!==undefined&&trade.direction==='sale'&&trade.amountMinor!==null){const paid=rows.filter(x=>x.kind==='receivable'&&x.tradeId===trade.id&&x.status!=='voided').reduce((s,x)=>s+x.paidMinor,0);if(paid<Math.ceil(trade.amountMinor*control.minPrepaymentPct/100))fulfillment.push('已核销回款未达到约定预付比例');}
 const missing=[...evaluation.missing];if(!control)missing.push('实货台账');else for(const [k,label] of [['batchNumber','批次'],['grade','牌号'],['warehouse','仓储或交付位置'],['titleEvidence','货权依据'],['qualityEvidence','质检依据']])if(!control[k])missing.push(label);
 const profitMissing=trade.direction==='purchase'?(control?.positionType==='unsold_inventory'?evaluation.inventoryLossMinor===null:evaluation.stressedCostMinor===null):evaluation.stressedMarginMinor===null;
 return {credit:dimension(trade.direction==='purchase'?'na':creditIssues.length?'high':review.status==='missing'?'missing':'watch',trade.direction==='purchase'?'采购不占客户额度':creditIssues.length?'授信条件未满足':review.status==='missing'?'复审待建立':'仍须人工审批',creditIssues),profit:dimension(profitMissing?'missing':evaluation.inventoryLossMinor>0||evaluation.stressedMarginMinor<0?'high':trade.direction==='purchase'||evaluation.stressedMarginMinor===0?'watch':'normal',trade.direction==='purchase'?(evaluation.inventoryLossMinor>0?'库存压力价值低于成本':'采购成本与库存价值'):profitMissing?'成本资料待补齐':evaluation.stressedMarginMinor<0?'压力后预计亏损':evaluation.stressedMarginMinor===0?'压力后毛差为零':'压力后毛差为正'),fulfillment:dimension(fulfillment.length?'high':control?'watch':'missing',fulfillment.length?'履约条件待处理':control?'待人工发货复核':'实货资料待补齐',fulfillment),documents:dimension(missing.length||review.status==='missing'?'missing':'watch',missing.length?'资料待补齐':review.status==='missing'?'资料待独立核验':'按复审版本核验',missing)};
}

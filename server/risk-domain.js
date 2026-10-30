import {createHash} from 'node:crypto';
import {fail} from './auth.js';
export const currencies=['USD','CNY'];
export const sources=['manual','import','estimate','example'];
export const realSource=s=>['manual','import'].includes(s);
export const blank=v=>v===null||v===undefined||(typeof v==='string'&&v.trim()==='');
export function text(v,label,max=500,optional=false){if(blank(v)&&optional)return null;if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw fail(400,label+'无效');return v.trim()}
export function choice(v,values,label,optional=false){if(blank(v)&&optional)return null;if(!values.includes(v))throw fail(400,label+'无效');return v}
export function number(v,label,min=0,max=1e9,optional=true){if(blank(v)&&optional)return null;if(typeof v==='boolean'||!['string','number'].includes(typeof v)||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)throw fail(400,label+'无效');return Number(v)}
export function minor(v,label='金额',optional=true){if(blank(v)&&optional)return null;const s=String(v);if(!/^\d{1,10}(\.\d{1,2})?$/.test(s))throw fail(400,label+'须为非负金额，最多两位小数');const [a,b='']=s.split('.');return Number(a)*100+Number(b.padEnd(2,'0'))}
export function bool(v,label){if(blank(v))return null;if(v===true||v==='true')return true;if(v===false||v==='false')return false;throw fail(400,label+'须为 true/false 或空值')}
export function day(v){if(blank(v))return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw fail(400,'到期日无效');return v}
export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const key=(kind,owner,value)=>kind+':'+digest([owner,value]);
export const profileFields=['name','partyType','registration','country','financialEvidence','performanceEvidence','notes','source','sourceNote','businessKey'];
export function profileInput(b){return {name:text(b.name,'企业名称',120),partyType:choice(b.partyType,['customer','supplier'],'档案类型'),registration:text(b.registration,'注册资料',120,true),country:text(b.country,'国家地区',80,true),financialEvidence:text(b.financialEvidence,'财务凭据',1000,true),performanceEvidence:text(b.performanceEvidence,'履约凭据',1000,true),notes:text(b.notes,'备注',1000,true),source:choice(b.source,sources,'数据来源'),sourceNote:text(b.sourceNote,'来源说明',1000),businessKey:text(b.businessKey,'业务唯一键',100)}}
export const tradeFields=['profileId','platformOrderId','businessKey','direction','currency','amount','quantity','unit','term','paymentMode','dueDate','steelUnitCost','steelCurrency','steelCostUnit','freight','freightCurrency','freightPayer','freightIncluded','fxRate','source','sourceNote'];
export function tradeInput(b){return {profileId:text(b.profileId,'档案编号',191),platformOrderId:text(b.platformOrderId,'平台订单编号',100,true),businessKey:text(b.businessKey,'业务唯一键',100),direction:choice(b.direction,['sale','purchase'],'合同方向'),currency:choice(b.currency,currencies,'合同币种',true),amountMinor:minor(b.amount),quantity:number(b.quantity,'数量',0.000001,1e9),unit:choice(b.unit,['吨','千克','件','套','米','双'],'计量单位',true),term:choice(b.term,['EXW','FOB','CFR','CIF','DAP','DDP'],'贸易条款',true),paymentMode:choice(b.paymentMode,['cash','credit'],'付款方式',true),dueDate:day(b.dueDate),steelUnitCostMinor:minor(b.steelUnitCost,'钢材单位成本'),steelCurrency:choice(b.steelCurrency,currencies,'成本币种',true),steelCostUnit:choice(b.steelCostUnit,['吨','千克','件','套','米','双'],'成本计量单位',true),freightMinor:minor(b.freight,'运费总额'),freightCurrency:choice(b.freightCurrency,currencies,'运费币种',true),freightPayer:choice(b.freightPayer,['self','counterparty'],'运费承担方',true),freightIncluded:bool(b.freightIncluded,'合同金额是否含运费'),fxRate:number(b.fxRate,'汇率 CNY/USD',0.0001,10000),source:choice(b.source,sources,'数据来源'),sourceNote:text(b.sourceNote,'来源说明',1000)}}
export function evaluate(trade,profile,rules,credit,now=new Date()){
 const missing=[],warnings=[];
 for(const [v,label] of [[profile.registration,'企业注册资料'],[profile.country,'国家地区'],[profile.financialEvidence,'财务凭据'],[profile.performanceEvidence,'履约凭据'],[trade.amountMinor,'合同金额'],[trade.currency,'合同币种'],[trade.quantity,'数量'],[trade.unit,'计量单位'],[trade.term,'贸易条款'],[trade.paymentMode,'付款方式'],[trade.freightPayer,'运费承担方'],[trade.freightIncluded,'合同是否含运费']])if(blank(v))missing.push(label);
 if(trade.paymentMode==='credit'&&!trade.dueDate)missing.push('赊销到期日');
 const costs={USD:0,CNY:0};let costsKnown=true;
 let multiplier=null;
 if(trade.unit&&trade.steelCostUnit){if(trade.unit===trade.steelCostUnit)multiplier=1;else if(trade.unit==='吨'&&trade.steelCostUnit==='千克')multiplier=1000;else if(trade.unit==='千克'&&trade.steelCostUnit==='吨')multiplier=.001;else missing.push('成本单位换算依据');}
 if(trade.steelUnitCostMinor===null||!trade.steelCurrency||trade.quantity===null||multiplier===null){missing.push('钢材单位成本及同单位数量');costsKnown=false;}
 else costs[trade.steelCurrency]=Math.round(trade.steelUnitCostMinor*trade.quantity*multiplier);
 if(!Number.isSafeInteger(costs.CNY)||!Number.isSafeInteger(costs.USD)){costsKnown=false;missing.push('成本总额超出支持精度');}
 const steel={...costs}, freight={USD:0,CNY:0};
 if(trade.freightPayer==='self'){
  if(trade.freightMinor===null||!trade.freightCurrency){missing.push('本方承担的运费总额及币种');costsKnown=false;}
  else freight[trade.freightCurrency]=trade.freightMinor;
 }else if(trade.freightPayer!=='counterparty')costsKnown=false;
 const outstandingMinor=trade.cancelled?0:trade.reserved?trade.amountMinor-trade.receivedMinor-trade.releasedMinor:trade.amountMinor;
 let overdueDays=null;
 if(trade.dueDate&&outstandingMinor>0){overdueDays=Math.max(0,Math.floor((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-Date.parse(trade.dueDate+'T00:00:00Z'))/86400000));if(overdueDays>=rules.overdueEscalationDays)warnings.push('逾期升级');else if(overdueDays>=rules.overdueWarningDays)warnings.push('逾期预警');}
 if(!realSource(trade.source)||!realSource(profile.source))warnings.push('预估或示例：仅测算，不进入真实额度账');
 if(trade.paymentMode==='credit'&&trade.direction==='sale'){
  if(!credit)warnings.push('未获批授信，默认额度为 0');
  else if(trade.amountMinor!==null&&!trade.reserved&&trade.amountMinor>credit.limitMinor-credit.occupiedMinor)warnings.push('可用授信不足');
 }
 const needsFx=trade.currency==='USD'||steel.USD!==0||freight.USD!==0;
 if(needsFx&&!trade.fxRate)missing.push('汇率 CNY/USD');
 const fx=trade.fxRate||1;
 const toCny=x=>x.CNY+x.USD*fx;
 let baseCostMinor=null,stressedCostMinor=null,baseMarginMinor=null,stressedMarginMinor=null,stressLossMinor=null;
 if(costsKnown&&(!needsFx||trade.fxRate)){
  const stressed={USD:steel.USD*(1+rules.steelShockPct/100)+freight.USD*(1+rules.freightShockPct/100),CNY:steel.CNY*(1+rules.steelShockPct/100)+freight.CNY*(1+rules.freightShockPct/100)};
  baseCostMinor=Math.round(toCny({USD:steel.USD+freight.USD,CNY:steel.CNY+freight.CNY}));
  const revenue={USD:0,CNY:0};
  const hasRevenue=trade.direction==='sale'&&trade.currency&&trade.amountMinor!==null&&trade.freightIncluded!==null;
  if(hasRevenue){revenue[trade.currency]=trade.amountMinor; // When freight is separate, equal reimbursement offsets it exactly once.
   if(trade.freightPayer==='self'&&trade.freightIncluded===false)revenue[trade.freightCurrency]+=trade.freightMinor;
  }
  const netUsd=revenue.USD-stressed.USD;
  const adverseFx=fx*(netUsd>=0?1-rules.fxShockPct/100:1+rules.fxShockPct/100);
  stressedCostMinor=Math.round(stressed.CNY+stressed.USD*adverseFx);
  if(hasRevenue){baseMarginMinor=Math.round(toCny(revenue)-baseCostMinor);stressedMarginMinor=Math.round(revenue.CNY-stressed.CNY+(revenue.USD-stressed.USD)*adverseFx);stressLossMinor=baseMarginMinor-stressedMarginMinor;if(stressedMarginMinor<0)warnings.push('压力情景下预计亏损');}
 }
 if([baseCostMinor,stressedCostMinor,baseMarginMinor,stressedMarginMinor,stressLossMinor].some(x=>x!==null&&!Number.isSafeInteger(x))){baseCostMinor=stressedCostMinor=baseMarginMinor=stressedMarginMinor=stressLossMinor=null;missing.push('测算金额超出支持精度');}
 if(trade.direction==='purchase')warnings.push('采购合同仅测算成本，不将采购金额作为销售收入');
 return {status:missing.length?'资料待补齐':'待人工审批',missing:[...new Set(missing)],warnings,outstandingMinor,overdueDays,reportingCurrency:'CNY',calculationSource:'estimate',baseCostMinor,stressedCostMinor,baseMarginMinor,stressedMarginMinor,stressLossMinor,rulesSnapshot:rules,profileSnapshot:profile,tradeSnapshot:trade,creditSnapshot:credit||null,evaluatedAt:now.toISOString(),method:'钢价成本上升、净 USD 敞口不利汇率、运费上升；运费单独收取时仅计一次等额补偿；不含未知税费、融资费及套保。局部毛利只含材料与运费，不是完整利润。试运行，非历史校准结果。',automaticRelease:false};
}
export function parseRows(format,content){
 if(typeof content!=='string'||content.length>80000)throw fail(400,'导入文件最多 80 KB');
 if(format==='json'){try{const rows=JSON.parse(content);if(!Array.isArray(rows))throw Error();return rows}catch{throw fail(400,'JSON 须为记录数组')}}
 if(format!=='csv')throw fail(400,'请选择 CSV 或 JSON');
 const rows=[];let row=[],field='',quoted=false,closed=false;content=content.replace(/^\uFEFF/,'');
 for(let i=0;i<content.length;i++){const c=content[i];if(quoted){if(c==='"'){if(content[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;}else if(c==='"'){if(field||closed)throw fail(400,'CSV 引号位置无效');quoted=true;}else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&content[i+1]==='\n')i++;if(row.some(x=>x!==''))rows.push(row);row=[];}}else{if(closed)throw fail(400,'CSV 引号后有无效字符');field+=c;}}
 if(quoted)throw fail(400,'CSV 引号未闭合');if(field||row.length||closed){row.push(field);rows.push(row)}
 const headers=rows.shift()||[];if(!headers.length||new Set(headers).size!==headers.length)throw fail(400,'CSV 表头为空或重复');
 return rows.map(r=>{if(r.length!==headers.length)throw fail(400,'CSV 列数不匹配');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]))});
}

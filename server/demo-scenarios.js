import {evaluate} from './risk-domain.js';
import {defaultRiskRules} from './risk-schema.js';
export const demoSeedVersion=2;
const shiftedDay=(date,days)=>new Date(date.getTime()+days*86400000).toISOString().slice(0,10);
export const scenarioSourceNote='经营逻辑情景假设 v2；所有价格、财务、履约与收款数据均为人工构造的预估输入，不是实时行情、已核验企业资料或历史统计预测。';
// Values are scenario assumptions in major currency units. No real company or document is implied.
const definitions=[
 {key:'A',title:'肯尼亚热轧卷 · 常规账期',country:'肯尼亚',product:'热轧钢卷 Q235B',quantity:80,price:620,cost:3300,freight:18000,term:'FOB',days:30,limit:100000,existing:20000,received:14880,years:12,revenue:86000000,ratio:1.65,history:48,pastDue:0,payment:'30%预付，70%在30天到期；假设预付款已收',security:'无担保，控制单笔应收规模',note:'材料成本、港前物流和汇率冲击后仍有正毛差，保持到期跟踪。'},
 {key:'B',title:'尼日利亚螺纹钢 · 薄利承压',country:'尼日利亚',product:'螺纹钢 HRB400E',quantity:200,price:500,cost:3350,freight:12000,term:'FOB',days:30,limit:150000,existing:20000,received:20000,years:8,revenue:62000000,ratio:1.25,history:26,pastDue:1,payment:'20%预付，80%在30天到期',security:'无担保，报价须覆盖压力成本',note:'基础毛差较薄，钢价及汇率同时不利时可能转亏，应重新议价或分批采购。'},
 {key:'C',title:'乌干达镀锌卷 · 授信容量不足',country:'乌干达',product:'镀锌钢卷 DX51D',quantity:120,price:640,cost:3420,freight:15000,term:'FOB',days:45,limit:80000,existing:50000,received:7680,years:6,revenue:45000000,ratio:1.3,history:18,pastDue:1,payment:'10%预付，90%在45天到期',security:'无担保，须增加预付或减少赊销',note:'利润不是授信容量；已有占用加本单应收超过假设额度，不能据此放行。'},
 {key:'D',title:'加纳型钢 · 部分回款逾期',country:'加纳',product:'热轧 H 型钢',quantity:60,price:590,cost:3250,freight:8500,term:'FOB',days:-3,limit:60000,existing:10000,received:17700,years:9,revenue:38000000,ratio:1.4,history:32,pastDue:2,payment:'假设已收50%，剩余50%逾期3天',security:'未设担保，人工对账与跟进回款',note:'部分回款不等于已结清；按剩余应收余额触发逾期预警。'},
 {key:'E',title:'坦桑尼亚钢卷 · 逾期升级',country:'坦桑尼亚',product:'热轧钢卷 Q355B',quantity:90,price:600,cost:3350,freight:12000,term:'FOB',days:-12,limit:70000,existing:20000,received:5400,years:5,revenue:29000000,ratio:1.05,history:16,pastDue:4,payment:'假设已收10%，剩余90%逾期12天',security:'无担保，升级至负责人复核',note:'逾期超过7天且假设额度利用率较高，应暂缓新增赊销，记录催收及争议依据。'},
 {key:'F',title:'塞内加尔钢管 · 海运费与汇率压力',country:'塞内加尔',product:'无缝碳钢管',quantity:100,price:790,cost:4200,freight:16000,freightCurrency:'USD',term:'CFR',days:45,limit:100000,existing:15000,received:23700,years:10,revenue:74000000,ratio:1.55,history:38,pastDue:1,payment:'30%预付，70%在45天到期',security:'运费计入合同报价，需核对船期与运价有效期',note:'CFR 由本方承担海运费，运费只计一次；高运费与净 USD 敞口会压缩毛差。'},
 {key:'G',title:'国内钢材采购 · 供应商预付款',country:'中国',product:'建筑钢材采购',direction:'purchase',currency:'CNY',quantity:30000,unit:'千克',price:3.6,cost:3600,freight:3000,term:'EXW',days:14,limit:0,existing:0,received:0,prepayment:21600,years:15,revenue:120000000,ratio:1.7,history:65,pastDue:1,payment:'20%预付，80%验收后支付；交付目标14天',security:'假设无预付款保函，需分批验收',note:'30000千克按30吨计算材料成本；预付款敞口独立展示，不作为客户授信占用或销售收入。'},
 {key:'H',title:'越南不锈钢 · 新客未授信',country:'越南',product:'304不锈钢板',quantity:20,price:1880,cost:10800,freight:5000,term:'FOB',days:15,limit:0,existing:0,received:11280,years:1,revenue:12000000,ratio:1.2,history:0,pastDue:0,payment:'假设预付30%，剩余70%申请15天赊销',security:'新客未授信，建议提高预付或采用信用证',note:'历史订单数明确假设为0；不能将无历史记录解释为信用良好，预测资料不能自动授信。'},
 {key:'I',title:'阿联酋钢卷 · 假设已结清',country:'阿联酋',product:'冷轧钢卷',quantity:50,price:630,cost:3350,freight:7500,term:'FOB',days:-10,limit:50000,existing:10000,received:31500,years:11,revenue:67000000,ratio:1.8,history:42,pastDue:0,payment:'假设合同款已全部收回；原到期日在10天前',security:'本单无未结清本金，仅保留其他合同假设占用',note:'本单余额为0，不因原到期日已过继续生成逾期预警；回款仅为情景输入。'},
];
const cents=x=>Math.round(x*100);
export function evaluateDemoScenario(trade,profile,rules=trade.forecast.rulesSnapshot||{...defaultRiskRules,demoScenario:true}){
 const forecast=trade.forecast,asOf=new Date(forecast.asOf);
 const raw=evaluate(trade,profile,rules,null,asOf);
 const verificationLabels=['企业注册资料','财务凭据','履约凭据'];
 const verificationMissing=raw.missing.filter(x=>verificationLabels.includes(x));
 const missing=raw.missing.filter(x=>!verificationLabels.includes(x));
 const purchase=trade.direction==='purchase';
 const outstandingMinor=trade.amountMinor===null?null:purchase?trade.amountMinor-forecast.prepaymentMinor:trade.amountMinor-forecast.receivedMinor;
 const proposedOccupationMinor=purchase?0:outstandingMinor;
 const occupiedMinor=proposedOccupationMinor===null?null:forecast.existingOccupiedMinor+proposedOccupationMinor;
 const availableMinor=occupiedMinor===null?null:forecast.limitMinor-occupiedMinor;
 const overdueDays=outstandingMinor===null?null:!purchase&&outstandingMinor>0?Math.max(0,Math.floor((Date.parse(forecast.asOf.slice(0,10)+'T00:00:00Z')-Date.parse(trade.dueDate+'T00:00:00Z'))/86400000)):0;
 const warnings=raw.warnings.filter(x=>!['未获批授信，默认额度为 0','可用授信不足','逾期预警','逾期升级'].includes(x));
 let outcome='压力后仍有毛差',tone='normal',recommendation=forecast.note;
 if(purchase){outcome='供应商预付款敞口';tone='watch';}
 else if(outstandingMinor===0){outcome='已结清（情景假设）';}
 else{
  if(raw.stressedMarginMinor<0){outcome='压力后预计亏损';tone='high';}
  if(availableMinor<0){warnings.push('情景授信缺口');outcome=forecast.limitMinor===0?'新客未授信':'授信容量不足';tone='high';}
  if(overdueDays>=rules.overdueEscalationDays){warnings.push('逾期升级');outcome='逾期升级';tone='high';}
  else if(overdueDays>=rules.overdueWarningDays){warnings.push('逾期预警');outcome='逾期预警';if(tone!=='high')tone='watch';}
 }
 if(missing.length){outcome='情景输入待补齐';tone='watch';}
 return {...raw,status:missing.length?'情景输入待补齐':'情景输入完整',missing,verificationMissing,verificationStatus:'演示企业资料未进行真实核验',warnings,outstandingMinor,overdueDays,creditSnapshot:null,
  forecast:{...forecast,proposedOccupationMinor,occupiedMinor,availableMinor,overLimitMinor:availableMinor===null?null:Math.max(0,-availableMinor),utilizationPct:forecast.limitMinor>0&&occupiedMinor!==null?Math.round(occupiedMinor/forecast.limitMinor*1000)/10:null,outstandingMinor,supplierPrepaymentExposureMinor:purchase?forecast.prepaymentMinor:0,outcome,tone,recommendation,source:'estimate',actualLedger:false},
  method:raw.method+' 情景额度、收款与处置均为独立假设，不进入真实授信账。真实资料核验单列，不用虚构证件填补。',evaluationAsOf:forecast.asOf};
}

export function buildDemoScenarios(user,asOf){
 const base={ownerId:user.id,isDemo:true,demoSetVersion:demoSeedVersion,source:'estimate',inputMethod:'demo',sourceNote:scenarioSourceNote,createdAt:asOf.toISOString()},prefix='demo:'+user.role+':v2:';
 const records=[];
 for(const d of definitions){
  const purchase=d.direction==='purchase',currency=d.currency||'USD';
  const profile={...base,id:prefix+'profile-'+d.key,kind:'profile',businessKey:'SCENARIO-'+d.key,name:'【情景预估】'+d.title,partyType:purchase?'supplier':'customer',version:1,country:d.country,registration:null,financialEvidence:null,performanceEvidence:null,notes:d.note,
   scenarioAssumptions:{asOf:asOf.toISOString(),source:'estimate',operatingYears:d.years,annualRevenueCnyMinor:cents(d.revenue),currentRatio:d.ratio,historicalOrderCount:d.history,onTimePerformancePct:d.history?Math.round((d.history-d.pastDue)/d.history*1000)/10:null,pastDueCount:d.pastDue,paymentTerms:d.payment,security:d.security,registrationReview:'情景假设企业已注册；未提供真实注册证件',financialReview:'使用假设财务指标进行演练；未取得真实财务报表',performanceReview:d.history?'履约统计为情景假设，并非已核实历史':'新客场景：假设历史订单为0，不推断良好履约'}};
  const trade={...base,id:prefix+'contract-'+d.key,kind:'trade',version:1,profileId:profile.id,platformOrderId:null,businessKey:'SCENARIO-'+d.key+' · '+d.product,direction:purchase?'purchase':'sale',currency,amountMinor:cents(d.quantity*d.price),quantity:d.quantity,unit:d.unit||'吨',term:d.term,paymentMode:purchase?'cash':'credit',dueDate:shiftedDay(asOf,d.days),steelUnitCostMinor:cents(d.cost),steelCurrency:'CNY',steelCostUnit:'吨',freightMinor:cents(d.freight),freightCurrency:d.freightCurrency||'CNY',freightPayer:'self',freightIncluded:!purchase,fxRate:7.12,reserved:false,receivedMinor:0,releasedMinor:0,cancelled:false,
   forecast:{asOf:asOf.toISOString(),source:'estimate',rulesSnapshot:{...defaultRiskRules,demoScenario:true},limitMinor:cents(d.limit),existingOccupiedMinor:cents(d.existing),receivedMinor:cents(d.received),prepaymentMinor:cents(d.prepayment||0),note:d.note,product:d.product,paymentTerms:d.payment,security:d.security,costBasis:purchase?'EXW：本方承担提货运费；千克与吨显式换算':d.term==='CFR'?'CFR：海运费由本方承担并包含在合同金额中，不重复增加敞口':'FOB：本方港前物流成本包含在本方成本；主海运由买方承担'}};
  const result=evaluateDemoScenario(trade,profile);
  const evaluation={...base,id:trade.id+':evaluation',kind:'evaluation',tradeId:trade.id,...result};
  const financial={...base,id:prefix+'financial-'+d.key,kind:'demo_case',tradeId:trade.id,profileId:profile.id,title:d.title,currency,illustrativeLimitMinor:cents(d.limit),illustrativeReserveMinor:result.forecast.proposedOccupationMinor,illustrativeReceiptMinor:cents(d.received),illustrativeOccupiedMinor:result.forecast.occupiedMinor,illustrativeAvailableMinor:result.forecast.availableMinor,steps:purchase?['假设合同本金 CNY '+(d.quantity*d.price).toLocaleString(),'假设预付款 CNY '+d.prepayment.toLocaleString(),'预付款单列供应商敞口，不占用客户授信']:[`假设授信总额 ${currency} ${d.limit.toLocaleString()}，其他合同已占用 ${d.existing.toLocaleString()}`,`本单合同额 ${currency} ${(d.quantity*d.price).toLocaleString()}，假设已收 ${d.received.toLocaleString()}`,`本单剩余应收 ${currency} ${(result.outstandingMinor/100).toLocaleString()}，仅记一次本金`,result.forecast.availableMinor<0?`预计额度缺口 ${currency} ${(-result.forecast.availableMinor/100).toLocaleString()}`:`预计可用额度 ${currency} ${(result.forecast.availableMinor/100).toLocaleString()}`],note:'情景算例，不构成真实授信、银行收款、批准或额度流水。'};
  const review={...base,id:prefix+'review-'+d.key,kind:'demo_review',tradeId:trade.id,title:d.title,outcome:result.forecast.outcome,recommendation:d.note,status:result.forecast.tone==='high'?'建议暂缓，转人工复核':purchase?'采购条件待人工核验':result.outstandingMinor===0?'假设已结清，保留复核记录':'待人工复核',reason:'依据情景输入、压力毛差、到期余额和假设额度测算；未作真实批准。',role:'风控复核岗位（示意）'};
  records.push(profile,trade,evaluation,financial,review);
  if(result.forecast.tone!=='normal')records.push({...base,id:prefix+'ticket-'+d.key,kind:'ticket',tradeId:trade.id,title:'【情景】'+result.forecast.outcome,severity:result.forecast.tone==='high'?'high':'warning',status:['D','E','G'].includes(d.key)?'in_progress':'open',assigneeId:user.id,version:1,resolution:d.note,evaluationSnapshot:result});
 }
 return records;
}

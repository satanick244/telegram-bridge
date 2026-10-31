import React,{useState} from 'react';
const money=(n,c='CNY')=>n===null||n===undefined?'不适用':`${c} ${(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const percent=(n,digits=1)=>n===null||n===undefined?'不适用':n.toFixed(digits)+'%';
export function ScenarioProfile({profile}){
 const a=profile.scenarioAssumptions;
 return <><p className="scenario-complete">情景输入完整 · 指标均为预估假设</p><dl>{[
  ['经营年限',a.operatingYears+' 年'],['年营业收入',money(a.annualRevenueCnyMinor)],['流动比率',a.currentRatio.toFixed(2)],['历史订单（假设）',a.historicalOrderCount+' 笔'],['按时履约比例',a.historicalOrderCount?percent(a.onTimePerformancePct):'新客无历史，不计算比例'],['历史逾期（假设）',a.pastDueCount+' 笔'],['结算安排',a.paymentTerms],['保障安排',a.security],['工商输入设定',a.registrationReview],['财务输入设定',a.financialReview],['履约输入设定',a.performanceReview],
 ].map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl><p className="muted">真实注册证件、报表和履约凭据未核验；上述内容用于推演，不是企业资质背书。</p></>;
}
export function ScenarioReview({review}){return <article className="risk-panel"><h3>{review.title}</h3><p className="scenario-complete">{review.status}</p><p>情景结论：{review.outcome}</p><p>处理建议：{review.recommendation}</p><p>{review.reason}</p><small className="muted">{review.role} · 仅为处置示意，无真实审批人、批准或放行。</small></article>}
export default function ScenarioExplorer({data}){
 const [filter,setFilter]=useState('all'),[selected,setSelected]=useState('');
 const trades=data.records.filter(x=>x.kind==='trade'&&x.forecast),profiles=data.records.filter(x=>x.kind==='profile');
 const scenarios=[...trades].sort((a,b)=>a.businessKey.localeCompare(b.businessKey)).map(t=>({trade:t,profile:profiles.find(p=>p.id===t.profileId),e:data.assessments.find(e=>e.tradeId===t.id)}));
 const filtered=scenarios.filter(({e})=>filter==='all'||e.forecast.tone===filter),active=filtered.find(x=>x.trade.id===selected)||filtered[0];
 const asOf=scenarios[0]?.trade.forecast.asOf;
 return <section className="scenario-explorer" aria-label="情景案例库">
  <div className="risk-panel"><div className="scenario-heading"><div><span className="eyebrow">FORECAST SCENARIOS</span><h2>9 组完整经营情景</h2><p>人工构造的合理经营假设，用于比较风险逻辑；不是实时行情或经历史校准的预测。</p></div><span className="risk-tag">版本 2 · 预估数据</span></div>
   <p className="muted">测算基准：{asOf?new Date(asOf).toLocaleString('zh-CN'):''}。账龄按该基准日 UTC 计算，场景日期固定；真实资料核验单列。</p>
   <div className="scenario-summary"><div><strong>{scenarios.length}</strong><span>完整情景</span></div><div><strong>{scenarios.filter(x=>x.e.forecast.tone==='high').length}</strong><span>需重点复核</span></div><div><strong>{scenarios.filter(x=>x.e.forecast.overLimitMinor>0).length}</strong><span>假设授信有缺口</span></div><div><strong>{scenarios.filter(x=>x.e.overdueDays>0).length}</strong><span>余额逾期案例</span></div></div>
   <div className="scenario-controls"><label>案例分类<select value={filter} onChange={e=>{setFilter(e.target.value);setSelected('')}}><option value="all">全部情景</option><option value="normal">毛差有余量 / 已结清</option><option value="watch">跟踪复核</option><option value="high">重点复核</option></select></label><label>选择案例<select value={active?.trade.id||''} onChange={e=>setSelected(e.target.value)}>{filtered.map(x=><option key={x.trade.id} value={x.trade.id}>{x.profile.name.replace('【情景预估】','')}</option>)}</select></label></div>
   <div className="table-wrap"><table className="scenario-table"><thead><tr><th>情景</th><th>合同金额</th><th>基准毛差 CNY</th><th>压力毛差 CNY</th><th>到期余额</th><th>处置关注</th></tr></thead><tbody>{filtered.map(x=><tr key={x.trade.id} className={active?.trade.id===x.trade.id?'scenario-selected':''}><td><button onClick={()=>setSelected(x.trade.id)}>{x.profile.name.replace('【情景预估】','')}</button><small>{x.trade.quantity.toLocaleString()} {x.trade.unit} · {x.trade.term}</small></td><td>{money(x.trade.amountMinor,x.trade.currency)}</td><td>{money(x.e.baseMarginMinor)}</td><td className={x.e.stressedMarginMinor<0?'scenario-negative':''}>{x.trade.direction==='purchase'?'采购，不计算销售收入':money(x.e.stressedMarginMinor)}</td><td>{money(x.e.outstandingMinor,x.trade.currency)}<small>{x.e.overdueDays?'逾期 '+x.e.overdueDays+' 天':'无逾期（情景）'}</small></td><td><span className={'scenario-outcome '+x.e.forecast.tone}>{x.e.forecast.outcome}</span></td></tr>)}</tbody></table></div>
   <p className="muted">毛差仅含已建模材料与运费，不包含未知税费、保险、融资及套保。各币种的本金不相加；表中毛差统一折算 CNY。</p>
  </div>
  {active&&<ScenarioDetail {...active}/>}
 </section>;
}
function ScenarioDetail({trade:t,profile:p,e}){
 const f=e.forecast,purchase=t.direction==='purchase';
 const result=[['合同本金',money(t.amountMinor,t.currency)],['材料单位成本',money(t.steelUnitCostMinor,t.steelCurrency)+' / '+t.steelCostUnit],['本方运费总额',money(t.freightMinor,t.freightCurrency)],['手工汇率 CNY/USD',t.fxRate.toFixed(2)],['基准材料/运费成本',money(e.baseCostMinor)],['压力材料/运费成本',money(e.stressedCostMinor)],['基准毛差',purchase?'采购，不计算收入':money(e.baseMarginMinor)],['压力毛差',purchase?'采购，不计算收入':money(e.stressedMarginMinor)],['假设已收款',purchase?'采购方向，不作为客户回款':money(f.receivedMinor,t.currency)],['剩余合同本金',money(f.outstandingMinor,t.currency)],['授信总额（假设）',purchase?'采购不占用客户授信':money(f.limitMinor,t.currency)],['预计占用 / 可用',purchase?'不适用':money(f.occupiedMinor,t.currency)+' / '+money(f.availableMinor,t.currency)],['预计授信缺口',purchase?'不适用':money(f.overLimitMinor,t.currency)],['假设额度利用率',purchase?'不适用':f.limitMinor?percent(f.utilizationPct):'未授信，不计算比例'],['供应商预付款敞口',purchase?money(f.supplierPrepaymentExposureMinor,t.currency):'销售方向，不适用'],['到期日 / 交付目标',t.dueDate]];
 return <article className="risk-panel scenario-detail"><div className="scenario-heading"><div><h2>{p.name.replace('【情景预估】','')}</h2><p>{p.country} · {f.product} · {t.quantity.toLocaleString()} {t.unit}</p></div><span className={'scenario-outcome '+f.tone}>{f.outcome}</span></div><div className="scenario-detail-grid">{result.map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div><div className="scenario-advice"><strong>情景处置建议</strong><p>{f.recommendation}</p><p>{f.costBasis}</p><p>结算假设：{f.paymentTerms}；保障安排：{f.security}。</p></div><details><summary>查看完整经营指标假设</summary><ScenarioProfile profile={p}/></details><p className="muted">情景测算输入已完整；真实企业资料仍未核验。不记录真实授信、收款或审批，不直接放行付款、发货、放货。</p></article>;
}

import React from 'react';
const names={credit:'信用与授信',profit:'收益与价格',fulfillment:'履约条件',documents:'资料与核验'};
export default function RiskDimensions({value}){
 if(!value)return null;
 return <div className="risk-dimensions" aria-label="四维风险评价">{Object.entries(names).map(([key,name])=>{const d=value[key];return d&&<section key={key} className={'risk-dimension '+d.state}><small>{name}</small><strong className={'scenario-outcome '+(d.state==='high'?'high':d.state==='normal'?'normal':'watch')}>{d.label}</strong>{d.items?.length>0&&<ul>{d.items.map(item=><li key={item}>{item}</li>)}</ul>}</section>})}</div>;
}

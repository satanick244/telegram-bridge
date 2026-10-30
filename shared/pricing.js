// Broad budgeting estimates in USD per stated unit, not supplier quotations.
const ranges={coil:[450,650],galvanized:[580,850],pipe:[650,1100],rebar:[430,650],sheet:[1500,2400],beam:[520,850],drill:[25,80],grinder:[20,60],hammer:[35,140],saw:[35,100],sander:[18,65],bits:[4,18],solar:[60,115],meter:[8,40],helmet:[2,9],gloves:[.8,5]};
export function estimateRange(p){
 let [low,high]=ranges[p.image]||[10,100];const n=p.name+' '+p.spec;
 if(p.image==='drill'&&n.includes('12V'))[low,high]=[12,28];
 if(p.image==='grinder'&&n.includes('230'))[low,high]=[40,95];
 if(p.image==='hammer'&&n.includes('重型'))[low,high]=[80,220];
 if(p.image==='sheet'&&n.includes('316'))[low,high]=[2100,3300];
 if(p.image==='solar'&&n.includes('450W'))[low,high]=[45,85];
 if(p.image==='solar'&&n.includes('600W'))[low,high]=[70,125];
 if(p.image==='meter'&&n.includes('工业维护'))[low,high]=[25,85];
 if(p.image==='sander'&&n.includes('无绳'))[low,high]=[35,100];
 return {low,high,currency:'USD',basis:'平台预算参考，非供应商实时报价'};
}
export const rangeLabel=p=>p.priceRange?'$'+p.priceRange.low.toFixed(p.priceRange.low<10?2:0)+'–$'+p.priceRange.high.toFixed(p.priceRange.high<10?2:0):'询价获取报价';

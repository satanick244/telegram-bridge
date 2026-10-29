export const productCategories = ['钢卷','钢管','建筑钢材','钢板','型钢','电动工具','电气与能源','工业防护'];
export const categoryImages = {钢卷:['coil','galvanized'],钢管:['pipe'],建筑钢材:['rebar'],钢板:['sheet'],型钢:['beam'],电动工具:['drill','grinder','hammer','saw','sander','bits'],电气与能源:['solar','meter'],工业防护:['helmet','gloves']};
export const units = ['吨','件','套','米','双'];
export const unitOf = product => product?.unit || (['钢卷','钢管','建筑钢材','钢板','型钢'].includes(product?.category) || !product?.category ? '吨' : '件');
export const unitEn = unit => ({吨:'t',件:'pc',套:'set',米:'m',双:'pair'})[unit] || unit;
export const marketGroups = [
 {id:'all',zh:'全部工业品',en:'All products',icon:'grid'},
 {id:'power-tools',zh:'工具与工厂耗品',en:'Tools & workshop',icon:'tool',categories:['电动工具']},
 {id:'steel',zh:'钢材与建筑材料',en:'Steel & construction',icon:'layers',categories:['钢卷','钢管','建筑钢材','钢板','型钢']},
 {id:'electrical',zh:'电气与新能源',en:'Electrical & energy',icon:'sun',categories:['电气与能源']},
 {id:'safety',zh:'安全防护用品',en:'Safety & protection',icon:'shield',categories:['工业防护']},
];
export function groupFromQuery(value) {
 if (value?.includes('diandonggongju') || value?.includes('gongjuyugongchangyihaopin')) return 'power-tools';
 return marketGroups.some(x=>x.id===value) ? value : 'all';
}

// Procurement selection briefs, not supplier offers. Commercial terms are unknown.
const selections={
 coil:[['低碳热轧钢卷','Low Carbon Hot Rolled Coil','Q235B · 厚度 2–6 mm'],['结构用热轧钢卷','Structural Hot Rolled Coil','Q355B · 厚度 6–12 mm']],
 galvanized:[['薄规格镀锌钢卷','Thin Gauge Galvanized Coil','DX51D+Z · 厚度 0.3–0.8 mm'],['建筑用镀锌钢卷','Construction Galvanized Coil','SGCC · 厚度 0.8–2.0 mm']],
 pipe:[['流体输送碳钢管','Carbon Steel Fluid Pipe','材质、外径与壁厚按用途确认'],['结构用无缝钢管','Structural Seamless Pipe','结构支撑 · 长度与壁厚可选']],
 rebar:[['HRB400E 建筑螺纹钢','HRB400E Construction Rebar','直径 12–20 mm · 长度待确认'],['HRB500E 高强螺纹钢','HRB500E High Strength Rebar','直径 20–32 mm · 标准待确认']],
 sheet:[['316L 不锈钢板','316L Stainless Steel Sheet','厚度 1–6 mm · 表面工艺待确认'],['冷轧 304 不锈钢薄板','Cold Rolled 304 Stainless Sheet','厚度 0.5–2 mm · 2B / BA 表面选型']],
 beam:[['轻型热轧 H 型钢','Light Hot Rolled H Section','H100–250 · 建筑与设备支撑'],['重型结构 H 型钢','Heavy Structural H Section','H300–600 · 长度与牌号待确认']],
 drill:[['12V 紧凑型充电电钻','12V Compact Cordless Drill','12V · 电池容量与夹头规格待确认'],['18V 冲击充电电钻','18V Cordless Hammer Drill','18V · 冲击 / 旋转 · 插头与电池待确认']],
 grinder:[['100 mm 便携角磨机','100 mm Compact Angle Grinder','100 mm 盘径 · 电压与功率待确认'],['230 mm 重型角磨机','230 mm Heavy Duty Angle Grinder','230 mm 盘径 · 工业切割用途']],
 hammer:[['轻型 SDS-Plus 电锤','Compact SDS-Plus Rotary Hammer','SDS-Plus 接口 · 钻孔范围待确认'],['重型混凝土电锤','Heavy Duty Concrete Rotary Hammer','混凝土作业 · 接口与冲击能待确认']],
 saw:[['165 mm 便携电圆锯','165 mm Portable Circular Saw','165 mm 锯片 · 切深与电压待确认'],['235 mm 木工电圆锯','235 mm Woodworking Circular Saw','235 mm 锯片 · 功率与切深待确认']],
 sander:[['150 mm 轨道砂光机','150 mm Orbital Sander','150 mm 砂盘 · 调速与集尘接口待确认'],['125 mm 无绳砂光机','125 mm Cordless Sander','125 mm 砂盘 · 电池平台待确认']],
 bits:[['十字螺丝批头套装','Phillips Screwdriver Bit Set','PH 规格组合 · 长度与包装待确认'],['六角与梅花批头套装','Hex and Torx Bit Set','Hex / Torx 规格组合 · 材料待确认']],
 solar:[['450W 单晶光伏组件','450W Monocrystalline Solar Module','450W 功率选型 · 尺寸与电参待确认'],['600W 光伏组件','600W Solar Module','600W 功率选型 · 单双面与尺寸待确认']],
 meter:[['便携数字万用表','Portable Digital Multimeter','AC / DC 测量 · 精度与安全等级待确认'],['工业维护数字万用表','Industrial Maintenance Multimeter','维护检修用途 · 量程与附件待确认']],
 helmet:[['通风型工业安全帽','Vented Industrial Safety Helmet','通风帽壳 · 材料与适用标准待确认'],['带下颏带作业安全帽','Safety Helmet with Chin Strap','下颏带与悬挂系统 · 适用工况待确认']],
 gloves:[['皮革搬运作业手套','Leather Handling Work Gloves','搬运用途 · M / L / XL 尺码选型'],['加长护腕皮革手套','Long Cuff Leather Work Gloves','加长护腕 · 材料与用途待确认']],
};
export function seedSourcingCatalog({db,get,put,all}){
 const migration='sourcing-selection-v1';
 if(db.prepare('SELECT name FROM migrations WHERE name=?').get(migration))return;
 db.exec('BEGIN IMMEDIATE');
 try{
  const ids=['p1','p2','p3','p4','p5','p6','t1','t2','t3','t4','t5','t6','e1','e2','h1','h2'];
  for(const id of ids){const p=get('products',id);if(!p||!['2026-10-01T08:00:00.000Z','2026-10-29T08:00:00.000Z'].includes(p.createdAt))continue;
   put('products',{...p,catalogOnly:true,sourceType:'采购选型条目，供供应商确认',supplierId:null,price:null,cost:null,stock:null,moq:null,port:'待确认',term:'待协商',lead:'询价确认',certifications:'标准与检测文件需供应商提供',grade:p.id.startsWith('p')?p.grade:p.name,featured:true});
  }
  for(const p of ids.map(id=>get('products',id)).filter(Boolean)){
   (selections[p.image]||[]).forEach(([name,en,spec],index)=>{const id='select-'+p.image+'-'+(index+1);if(!get('products',id))put('products',{...p,id,name,en,spec,grade:'按需求选型',catalogOnly:true,sourceType:'采购选型条目，供供应商确认',supplierId:null,price:null,cost:null,stock:null,moq:null,featured:false,createdAt:'2026-10-30T04:00:00.000Z'});});
  }
  for(const id of ['s1','s2','s3','s-tools','s-energy','s-safety']){const s=get('suppliers',id);if(s)put('suppliers',{...s,isSample:true});}
  for(const id of ['SF-202610-0085','SF-202610-0086','SF-202610-0087','SF-202610-0088']){const o=get('orders',id);if(o&&o.email==='buyer@example.com')put('orders',{...o,isSample:true});}
  for(const id of ['RFQ-260018','RFQ-260017']){const q=get('inquiries',id);if(q&&q.email==='buyer@example.com')put('inquiries',{...q,isSample:true});}
  db.prepare('INSERT INTO migrations(name,applied_at) VALUES(?,?)').run(migration,new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function seedIndustrialCatalog({db,get,put}) {
 db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
 if(db.prepare('SELECT name FROM migrations WHERE name=?').get('industrial-catalog-v1'))return;
 db.exec('BEGIN IMMEDIATE');
 try{
  [
   {id:'s-tools',name:'睿虎机电科技',en:'Ruihu Power Tools',location:'中国 · 浙江',contact:'张经理',certifications:'示例企业资料 · 可协商出口文件',years:8,verified:false},
   {id:'s-energy',name:'光屿能源设备',en:'Guangyu Energy Systems',location:'中国 · 江苏',contact:'李经理',certifications:'示例企业资料 · 产品规格可询',years:6,verified:false},
   {id:'s-safety',name:'安达工业防护',en:'Anda Industrial Safety',location:'中国 · 山东',contact:'赵经理',certifications:'示例企业资料 · 样品可协商',years:9,verified:false},
  ].forEach(x=>{if(!get('suppliers',x.id))put('suppliers',x)});
  const rows=[
   ['t1','20V 无刷充电式电钻','20V Brushless Cordless Drill','电动工具','RH-CD20','20V · 60 N·m · 双速调节',42.5,210,2400,10,'drill','件','s-tools'],
   ['t2','125 mm 工业级角磨机','125 mm Industrial Angle Grinder','电动工具','RH-AG125','900W · 11,000 rpm · 220V',28.8,138,1800,10,'grinder','件','s-tools'],
   ['t3','26 mm 多功能电锤','26 mm SDS-Plus Rotary Hammer','电动工具','RH-RH26','800W · SDS-Plus · 三功能',67,330,960,5,'hammer','件','s-tools'],
   ['t4','185 mm 木工电圆锯','185 mm Electric Circular Saw','电动工具','RH-CS185','1,400W · 5,500 rpm · 45° 斜切',56,280,800,10,'saw','件','s-tools'],
   ['t5','125 mm 随机轨道砂光机','125 mm Random Orbital Sander','电动工具','RH-OS125','300W · 六档调速 · 集尘接口',32.4,156,1500,10,'sander','件','s-tools'],
   ['t6','工业级螺丝批头组合套装','Industrial Screwdriver Bit Set','电动工具','RH-BS32','32 件套 · S2 工具钢 · 磁性接杆',12.8,58,4000,20,'bits','套','s-tools'],
   ['e1','550W 单晶光伏组件','550W Monocrystalline Solar Module','电气与能源','GY-PV550','550W · 单晶硅 · 铝合金边框',89,460,1600,20,'solar','件','s-energy'],
   ['e2','自动量程数字万用表','Auto-Ranging Digital Multimeter','电气与能源','GY-DM6000','6,000 counts · AC/DC · 温度测量',18.6,89,3000,20,'meter','件','s-energy'],
   ['h1','工业现场安全帽','Industrial Safety Helmet','工业防护','AD-H01','HDPE 帽壳 · 六点悬挂 · 可调头箍',3.9,15.8,12000,100,'helmet','件','s-safety'],
   ['h2','皮革工业作业手套','Leather Industrial Work Gloves','工业防护','AD-G08','皮革掌面 · 搬运作业 · M/L/XL',1.6,5.8,30000,200,'gloves','双','s-safety'],
  ];
  for(const [id,name,en,category,grade,spec,price,cost,stock,moq,image,unit,supplierId] of rows){
   if(!get('products',id))put('products',{id,name,en,category,grade,spec,price,cost,stock,moq,image,unit,supplierId,port:'宁波港',term:'FOB',certifications:'具体认证与测试报告请询供应商',featured:true,lead:'15–25 天',status:'在售',demo:true,createdAt:'2026-10-29T08:00:00.000Z'});
  }
  db.prepare('INSERT INTO migrations(name,applied_at) VALUES(?,?)').run('industrial-catalog-v1',new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}

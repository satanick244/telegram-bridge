import { estimateRange } from '../shared/pricing.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { seedIndustrialCatalog } from './industrial-seed.js';
import { seedSourcingCatalog } from './sourcing-catalog.js';
export function createDatabase(file = process.env.DATABASE_PATH || './data/steelflow.db') {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiries (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS ip_application_registration ON applications(json_extract(data, '$.registration'));`);
  const all = table => db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`).all().map(row => JSON.parse(row.data));
  const get = (table, id) => { const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id); return row ? JSON.parse(row.data) : null; };
  const put = (table, item) => { db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(item.id, JSON.stringify(item)); return item; };
  if (!db.prepare('SELECT id FROM suppliers LIMIT 1').get()) {
    [
      { id: 's1', name: '华东钢铁集团', en: 'East China Steel Group', location: '中国 · 江苏', contact: '王经理', verified: true, certifications: 'ISO 9001 · CE · SGS', years: 12, score: 4.9 },
      { id: 's2', name: '宝信金属科技', en: 'Baoxin Metal Technology', location: '中国 · 上海', contact: '陈经理', verified: true, certifications: 'ISO 9001 · ASTM', years: 8, score: 4.8 },
      { id: 's3', name: '山东恒丰钢业', en: 'Hengfeng Steel', location: '中国 · 山东', contact: '刘经理', verified: true, certifications: 'ISO 9001 · SGS', years: 10, score: 4.9 },
    ].forEach(x => put('suppliers', x));
    [
      { id: 'p1', name: '优质热轧钢卷', en: 'Hot Rolled Steel Coil', category: '钢卷', grade: 'Q235B / SS400', spec: '3.0–12.0 × 1,250 mm', price: 528, cost: 3050, stock: 4800, moq: 25, port: '上海港', term: 'FOB', supplierId: 's1', image: 'coil', certifications: 'ISO 9001, SGS', featured: true, lead: '7–15 天', status: '在售' },
      { id: 'p2', name: '镀锌钢卷', en: 'Galvanized Steel Coil', category: '钢卷', grade: 'DX51D+Z / SGCC', spec: '0.3–2.0 × 1,250 mm', price: 685, cost: 3890, stock: 2600, moq: 25, port: '青岛港', term: 'FOB', supplierId: 's3', image: 'galvanized', certifications: 'ISO 9001, ASTM', featured: true, lead: '10–20 天', status: '在售' },
      { id: 'p3', name: '无缝碳钢管', en: 'Seamless Carbon Steel Pipe', category: '钢管', grade: 'ASTM A106 Gr.B', spec: 'Φ21.3–610 × 2.0–30 mm', price: 742, cost: 4210, stock: 1850, moq: 20, port: '天津港', term: 'FOB', supplierId: 's2', image: 'pipe', certifications: 'API 5L, ISO 9001', featured: true, lead: '15–25 天', status: '在售' },
      { id: 'p4', name: '高强度螺纹钢', en: 'Deformed Steel Rebar', category: '建筑钢材', grade: 'HRB400E / ASTM A615', spec: 'Φ10–32 mm × 12 m', price: 512, cost: 2880, stock: 6200, moq: 50, port: '上海港', term: 'FOB', supplierId: 's1', image: 'rebar', certifications: 'BS 4449, SGS', featured: true, lead: '7–14 天', status: '在售' },
      { id: 'p5', name: '304 不锈钢板', en: '304 Stainless Steel Sheet', category: '钢板', grade: '304 / ASTM A240', spec: '0.8–6.0 × 1,219 × 2,438 mm', price: 1860, cost: 10880, stock: 960, moq: 10, port: '上海港', term: 'FOB', supplierId: 's2', image: 'sheet', certifications: 'ISO 9001, EN 10204', featured: false, lead: '10–18 天', status: '在售' },
      { id: 'p6', name: '热轧 H 型钢', en: 'Hot Rolled H Beam', category: '型钢', grade: 'Q355B / S355JR', spec: 'H100–600 × 100–300 mm', price: 596, cost: 3390, stock: 3200, moq: 25, port: '青岛港', term: 'FOB', supplierId: 's3', image: 'beam', certifications: 'CE, EN 10025', featured: false, lead: '10–20 天', status: '在售' },
    ].forEach(x => put('products', { ...x, createdAt: '2026-10-01T08:00:00.000Z' }));
    [
      { id: 'SF-202610-0086', productId: 'p1', productName: '优质热轧钢卷', supplierId: 's1', buyer: 'Al Noor Trading LLC', country: '阿联酋', destination: '杰贝阿里港', quantity: 200, unitPrice: 528, total: 105600, status: '运输中', createdAt: '2026-10-20T08:00:00.000Z', term: 'FOB', shipping: 'COSCO SHIPPING · 示例航次', eta: '2026-11-04' },
      { id: 'SF-202610-0087', productId: 'p3', productName: '无缝碳钢管', supplierId: 's2', buyer: 'Pacific Build Co.', country: '越南', destination: '胡志明港', quantity: 80, unitPrice: 742, total: 59360, status: '生产备货', createdAt: '2026-10-21T08:00:00.000Z', term: 'FOB' },
      { id: 'SF-202610-0088', productId: 'p2', productName: '镀锌钢卷', supplierId: 's3', buyer: 'Meridian Industries', country: '马来西亚', destination: '巴生港', quantity: 150, unitPrice: 685, total: 102750, status: '待确认', createdAt: '2026-10-22T08:00:00.000Z', term: 'FOB' },
      { id: 'SF-202610-0085', productId: 'p4', productName: '高强度螺纹钢', supplierId: 's1', buyer: 'Gulf Construction', country: '沙特阿拉伯', destination: '达曼港', quantity: 300, unitPrice: 512, total: 153600, status: '已完成', createdAt: '2026-10-18T08:00:00.000Z', term: 'FOB' },
    ].forEach(x => put('orders', { ...x, email: 'buyer@example.com', history: [{ status: x.status, at: x.createdAt }] }));
    put('inquiries', { id: 'RFQ-260018', productId: 'p6', productName: '热轧 H 型钢', buyer: 'Khalid Building Materials', country: '阿联酋', email: 'buyer@example.com', quantity: 500, message: '需要 S355JR 材质，支持第三方验货，交货期 30 天内。', status: '待报价', createdAt: '2026-10-22T06:00:00.000Z' });
    put('inquiries', { id: 'RFQ-260017', productId: 'p2', productName: '镀锌钢卷', buyer: 'Vina Steel Import', country: '越南', email: 'buyer@example.com', quantity: 200, message: '锌层 Z120，请提供 FOB 报价及材质证明。', status: '已报价', quotedPrice: 680, createdAt: '2026-10-21T06:00:00.000Z' });
  }
  seedIndustrialCatalog({db,get,put});
  seedSourcingCatalog({db,get,put,all});
  for(const p of all('products'))if(p.catalogOnly&&!p.priceRange)put('products',{...p,priceRange:estimateRange(p)});
  const insert=(table,item)=>{db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?)`).run(item.id,JSON.stringify(item));return item;};
  const remove=(table,id)=>db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  let tail=Promise.resolve();
  const store={db,all,get,put,insert,remove,engine:'sqlite',close:()=>db.close(),probe:()=>db.prepare('SELECT 1').get()};
  store.transaction=async fn=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;db.exec('BEGIN IMMEDIATE');try{const result=await fn(store);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}finally{release();}};
  return store;
}

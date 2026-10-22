import express from 'express';
import { randomUUID } from 'node:crypto';
import { calculateProfit, orderStatuses, validateOrder } from './domain.js';
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label}不能为空，且长度不得超过 ${max} 字符`);
  return value.trim();
};
const number = (value, label, min = 0, max = 1e8) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}须在 ${min}–${max} 之间`);
  return value;
};
const email = value => { const v = text(value, '邮箱'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('请输入有效邮箱'); return v; };
export function createApp(store) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'demo' }));
  app.get('/api/bootstrap', (req, res) => res.json(Object.fromEntries(['products', 'suppliers', 'orders', 'inquiries', 'applications'].map(t => [t, store.all(t).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))]))));
  app.post('/api/profit', (req, res) => res.json(calculateProfit(req.body)));
  app.post('/api/products', (req, res) => {
    const b = req.body;
    if (!store.get('suppliers', b.supplierId)) throw new Error('请选择有效供应商');
    const category = text(b.category, '品类');
    if (!['钢卷', '钢管', '建筑钢材', '钢板', '型钢'].includes(category)) throw new Error('品类无效');
    const stock = number(b.stock, '库存', 1, 1e7), moq = number(b.moq, '起订量', 1, 1e7);
    if (!Number.isSafeInteger(stock) || !Number.isSafeInteger(moq) || moq > stock) throw new Error('库存与起订量须为整数，且库存不少于起订量');
    const item = { id: randomUUID(), name: text(b.name, '商品名称', 80), en: text(b.en || b.name, '英文名称', 120), category, grade: text(b.grade, '钢种牌号', 80), spec: text(b.spec, '规格', 150), price: number(b.price, '售价', 1, 1e6), cost: number(b.cost, '成本', 0, 1e6), stock, moq, port: text(b.port, '装运港'), term: ['FOB', 'CIF', 'CFR', 'EXW'].includes(b.term) ? b.term : 'FOB', supplierId: b.supplierId, image: ({ 钢卷: 'coil', 钢管: 'pipe', 建筑钢材: 'rebar', 钢板: 'sheet', 型钢: 'beam' })[category], certifications: text(b.certifications || '待补充', '认证'), lead: text(b.lead || '15–30 天', '交期'), status: '在售', createdAt: new Date().toISOString() };
    store.put('products', item); res.status(201).json(item);
  });
  app.patch('/api/products/:id', (req, res) => {
    const item = store.get('products', req.params.id);
    if (!item) return res.status(404).json({ error: '商品不存在' });
    if (!['在售', '已下架'].includes(req.body.status)) throw new Error('商品状态无效');
    res.json(store.put('products', { ...item, status: req.body.status }));
  });
  app.post('/api/applications', (req, res) => {
    const b = req.body;
    const registration = text(b.registration, '统一社会信用代码', 18).toUpperCase();
    if (!/^[0-9A-Z]{18}$/.test(registration)) throw new Error('统一社会信用代码须为 18 位字母或数字');
    if (store.all('applications').some(a => a.registration === registration)) throw new Error('该企业已提交申请，请勿重复提交');
    const item = { id: `APP-${randomUUID().slice(0, 8)}`, company: text(b.company, '企业名称', 100), registration, contact: text(b.contact, '联系人', 80), email: email(b.email), location: text(b.location, '企业所在地'), category: text(b.category, '主营品类'), capacity: number(b.capacity, '年产能', 1, 1e9), certifications: text(b.certifications || '待补充', '认证'), status: '待审核', createdAt: new Date().toISOString() };
    store.put('applications', item); res.status(201).json(item);
  });
  app.patch('/api/applications/:id', (req, res) => {
    const a = store.get('applications', req.params.id);
    if (!a) return res.status(404).json({ error: '申请不存在' });
    if (a.status !== '待审核') throw new Error('该申请已处理');
    if (!['已通过', '需补充资料'].includes(req.body.status)) throw new Error('审核状态无效');
    if (req.body.status === '已通过') store.put('suppliers', { id: a.id, name: a.company, en: a.company, location: a.location, contact: a.contact, verified: true, certifications: a.certifications, years: 0, score: null });
    res.json(store.put('applications', { ...a, status: req.body.status }));
  });
  app.post('/api/orders', (req, res) => {
    const b = req.body, p = store.get('products', b.productId);
    if (!p || p.status !== '在售') throw new Error('商品不存在或已下架');
    const total = validateOrder(p, b.quantity);
    const item = { id: `SF-${new Date().toISOString().slice(0, 7).replace('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`, productId: p.id, productName: p.name, supplierId: p.supplierId, buyer: text(b.buyer, '买方企业'), email: email(b.email), country: text(b.country, '目的国'), destination: text(b.destination, '目的港'), quantity: b.quantity, unitPrice: p.price, costCny: p.cost, exchangeRate: 7.12, feeRate: 2, total, term: p.term, status: '待确认', createdAt: new Date().toISOString(), history: [{ status: '待确认', at: new Date().toISOString() }] };
    store.db.exec('BEGIN IMMEDIATE');
    try { store.put('products', { ...p, stock: p.stock - b.quantity }); store.put('orders', item); store.db.exec('COMMIT'); } catch (e) { store.db.exec('ROLLBACK'); throw e; }
    res.status(201).json(item);
  });
  app.patch('/api/orders/:id/advance', (req, res) => {
    const item = store.get('orders', req.params.id);
    if (!item) return res.status(404).json({ error: '订单不存在' });
    const index = orderStatuses.indexOf(item.status);
    if (index === orderStatuses.length - 1) throw new Error('订单已完成');
    const status = orderStatuses[index + 1];
    res.json(store.put('orders', { ...item, status, history: [...(item.history || []), { status, at: new Date().toISOString() }] }));
  });
  app.post('/api/inquiries', (req, res) => {
    const b = req.body, p = store.get('products', b.productId);
    if (!p || p.status !== '在售') throw new Error('商品不存在或已下架');
    const quantity = number(b.quantity, '询价数量', p.moq, p.stock);
    if (!Number.isSafeInteger(quantity)) throw new Error('询价数量须为整数');
    const item = { id: `RFQ-${randomUUID().slice(0, 8).toUpperCase()}`, productId: p.id, productName: p.name, buyer: text(b.buyer, '公司名称'), email: email(b.email), country: text(b.country, '目的国'), quantity, message: text(b.message, '采购要求', 2000), status: '待报价', createdAt: new Date().toISOString() };
    store.put('inquiries', item); res.status(201).json(item);
  });
  app.patch('/api/inquiries/:id/quote', (req, res) => {
    const item = store.get('inquiries', req.params.id);
    if (!item) return res.status(404).json({ error: '询价单不存在' });
    if (item.status !== '待报价') throw new Error('该询价已报价');
    res.json(store.put('inquiries', { ...item, quotedPrice: number(req.body.price, '报价', 1, 1e6), status: '已报价', quotedAt: new Date().toISOString() }));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((err, req, res, next) => res.status(400).json({ error: err.message || '请求失败' }));
  return app;
}

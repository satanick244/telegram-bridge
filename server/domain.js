import { unitOf } from '../shared/catalog.js';
export const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export function calculateProfit({ price, cost, quantity, freight = 0, other = 0, feeRate = 2, exchangeRate = 7.12 }) {
  for (const [key, value] of Object.entries({ price, cost, quantity, freight, other, feeRate, exchangeRate })) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${key} 必须为非负有效数值`);
  }
  if (!quantity || !exchangeRate || feeRate > 100) throw new Error('数量、汇率或费率无效');
  const revenue = round(price * quantity);
  const purchaseCost = round(cost / exchangeRate * quantity);
  const platformFee = round(revenue * feeRate / 100);
  const logistics = round(freight * quantity);
  const expenses = round(purchaseCost + platformFee + logistics + other);
  const profit = round(revenue - expenses);
  return { revenue, purchaseCost, platformFee, logistics, expenses, profit, margin: revenue ? round(profit / revenue * 100) : 0, perTon: round(profit / quantity) };
}
export const orderStatuses = ['待确认', '合同确认', '生产备货', '待装运', '运输中', '已完成'];
export function validateOrder(product, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < product.moq) throw new Error(`采购量须为整数，且不少于 ${product.moq} ${unitOf(product)}`);
  if (quantity > product.stock) throw new Error('当前可售库存不足');
  return round(product.price * quantity);
}

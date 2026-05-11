// Воронка продаж по источникам привлечения.
//
// Стадии (для покупателей с привязанным источником):
//   1. Контрагенты — все с этим источником
//   2. С заказом — из них есть хотя бы один OrderBuyer за период
//   3. Совершена продажа — есть Realizacia за период
//   4. Сумма выручки + средний чек
//
// Конверсии: с заказом / контрагенты, продажа / с заказом.
// Потери = с заказом, но без продажи (заказ не дошёл до отгрузки за период).

import { prisma } from '@/lib/db';

export interface FunnelStageRow {
  sourceId: string | null;
  sourceName: string;
  contractors: number;
  withOrder: number;
  withSale: number;
  revenue: number;
  cost: number;
  profit: number;
  ordersCount: number;
  ordersAmount: number;
  avgCheck: number;
  convOrder: number;       // % контрагентов с заказом
  convSale: number;        // % с заказом, у которых есть продажа
  losses: number;          // контрагенты с заказом, но без продажи
  lossesAmount: number;    // сумма таких заказов
}

export interface FunnelReport {
  from: Date;
  to: Date;
  rows: FunnelStageRow[];
  totals: Omit<FunnelStageRow, 'sourceId' | 'sourceName' | 'convOrder' | 'convSale'> & {
    convOrder: number;
    convSale: number;
    sourceId: null;
    sourceName: 'Итого';
  };
}

export async function buildFunnel(opts: { from: Date; to: Date }): Promise<FunnelReport> {
  const [sources, contractors, orders, sales] = await Promise.all([
    prisma.attractionSource.findMany(),
    prisma.kontragent.findMany({
      where: { isFolder: false },
      select: { id: true, attractionSourceId: true },
    }),
    prisma.orderBuyer.groupBy({
      by: ['kontragentId'],
      where: { posted: true, date: { gte: opts.from, lte: opts.to }, kontragentId: { not: null } },
      _count: true,
      _sum: { totalAmount: true },
    }),
    prisma.realizacia.groupBy({
      by: ['kontragentId'],
      where: { posted: true, date: { gte: opts.from, lte: opts.to }, kontragentId: { not: null } },
      _count: true,
      _sum: { totalAmount: true, totalCost: true },
    }),
  ]);

  // Карты
  const sourceById = new Map(sources.map((s) => [s.id, s.name]));
  const sourceByKont = new Map<string, string | null>();
  for (const k of contractors) sourceByKont.set(k.id, k.attractionSourceId);

  const ordersByKont = new Map<string, { count: number; amount: number }>();
  for (const o of orders) {
    if (!o.kontragentId) continue;
    ordersByKont.set(o.kontragentId, { count: o._count, amount: o._sum.totalAmount || 0 });
  }
  const salesByKont = new Map<string, { count: number; amount: number; cost: number }>();
  for (const s of sales) {
    if (!s.kontragentId) continue;
    salesByKont.set(s.kontragentId, {
      count: s._count,
      amount: s._sum.totalAmount || 0,
      cost: s._sum.totalCost || 0,
    });
  }

  // Группируем по источнику
  type Bucket = {
    contractors: Set<string>;
    withOrderSet: Set<string>;
    withSaleSet: Set<string>;
    revenue: number;
    cost: number;
    ordersCount: number;
    ordersAmount: number;
    salesCount: number;
  };
  const buckets = new Map<string, Bucket>();
  function getBucket(key: string): Bucket {
    let b = buckets.get(key);
    if (!b) {
      b = {
        contractors: new Set(), withOrderSet: new Set(), withSaleSet: new Set(),
        revenue: 0, cost: 0, ordersCount: 0, ordersAmount: 0, salesCount: 0,
      };
      buckets.set(key, b);
    }
    return b;
  }

  // Все контрагенты — добавляем в свой источник
  for (const k of contractors) {
    const key = k.attractionSourceId || 'unknown';
    getBucket(key).contractors.add(k.id);
  }

  // Покупатели с заказами
  for (const [kid, o] of ordersByKont) {
    const sid = sourceByKont.get(kid) || 'unknown';
    const b = getBucket(sid);
    b.withOrderSet.add(kid);
    b.ordersCount += o.count;
    b.ordersAmount += o.amount;
  }
  // С продажами
  for (const [kid, s] of salesByKont) {
    const sid = sourceByKont.get(kid) || 'unknown';
    const b = getBucket(sid);
    b.withSaleSet.add(kid);
    b.salesCount += s.count;
    b.revenue += s.amount;
    b.cost += s.cost;
  }

  const rows: FunnelStageRow[] = Array.from(buckets.entries()).map(([sid, b]) => {
    const losses = b.withOrderSet.size - b.withSaleSet.size;
    let lossesAmount = 0;
    for (const kid of b.withOrderSet) {
      if (!b.withSaleSet.has(kid)) lossesAmount += ordersByKont.get(kid)?.amount || 0;
    }
    return {
      sourceId: sid === 'unknown' ? null : sid,
      sourceName: sid === 'unknown' ? '— без источника —' : sourceById.get(sid) || sid,
      contractors: b.contractors.size,
      withOrder: b.withOrderSet.size,
      withSale: b.withSaleSet.size,
      revenue: b.revenue,
      cost: b.cost,
      profit: b.revenue - b.cost,
      ordersCount: b.ordersCount,
      ordersAmount: b.ordersAmount,
      avgCheck: b.salesCount > 0 ? b.revenue / b.salesCount : 0,
      convOrder: b.contractors.size > 0 ? (b.withOrderSet.size / b.contractors.size) * 100 : 0,
      convSale: b.withOrderSet.size > 0 ? (b.withSaleSet.size / b.withOrderSet.size) * 100 : 0,
      losses,
      lossesAmount,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const totalContractors = rows.reduce((s, r) => s + r.contractors, 0);
  const totalWithOrder = rows.reduce((s, r) => s + r.withOrder, 0);
  const totalWithSale = rows.reduce((s, r) => s + r.withSale, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalOrdersCount = rows.reduce((s, r) => s + r.ordersCount, 0);
  const totalOrdersAmount = rows.reduce((s, r) => s + r.ordersAmount, 0);
  const totalLosses = rows.reduce((s, r) => s + r.losses, 0);
  const totalLossesAmount = rows.reduce((s, r) => s + r.lossesAmount, 0);
  const totals = {
    sourceId: null,
    sourceName: 'Итого' as const,
    contractors: totalContractors,
    withOrder: totalWithOrder,
    withSale: totalWithSale,
    revenue: totalRevenue,
    cost: totalCost,
    profit: totalRevenue - totalCost,
    ordersCount: totalOrdersCount,
    ordersAmount: totalOrdersAmount,
    avgCheck: totalWithSale > 0 ? totalRevenue / totalWithSale : 0,
    convOrder: totalContractors > 0 ? (totalWithOrder / totalContractors) * 100 : 0,
    convSale: totalWithOrder > 0 ? (totalWithSale / totalWithOrder) * 100 : 0,
    losses: totalLosses,
    lossesAmount: totalLossesAmount,
  };

  return { from: opts.from, to: opts.to, rows, totals };
}

// Отчёт «Заказы покупателей менеджера» — сводка по менеджерам.
// Берём из двух источников: OrderBuyer (заказы) и Realizacia (фактические отгрузки).

import { prisma } from '@/lib/db';

export interface ManagerRow {
  name: string;
  ordersCount: number;
  ordersAmount: number;
  ordersPaid: number;
  salesCount: number;
  salesAmount: number;
  salesCost: number;
  salesProfit: number;
  salesMargin: number;
  avgCheck: number;     // средний чек по реализациям
  conversion: number;   // ordersPaid / ordersAmount
}

export interface ManagerReport {
  from: Date;
  to: Date;
  totals: {
    ordersCount: number;
    ordersAmount: number;
    ordersPaid: number;
    salesCount: number;
    salesAmount: number;
    salesCost: number;
    salesProfit: number;
  };
  rows: ManagerRow[];
}

export async function buildOrdersByManager(opts: { from: Date; to: Date }): Promise<ManagerReport> {
  const [orders, sales] = await Promise.all([
    prisma.orderBuyer.groupBy({
      by: ['responsibleName'],
      where: { posted: true, date: { gte: opts.from, lte: opts.to } },
      _count: true,
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.realizacia.groupBy({
      by: ['responsibleName'],
      where: { posted: true, date: { gte: opts.from, lte: opts.to } },
      _count: true,
      _sum: { totalAmount: true, totalCost: true },
    }),
  ]);

  const map = new Map<string, ManagerRow>();
  for (const o of orders) {
    const name = o.responsibleName || '—';
    const row = ensure(map, name);
    row.ordersCount = o._count;
    row.ordersAmount = o._sum.totalAmount || 0;
    row.ordersPaid = o._sum.paidAmount || 0;
  }
  for (const s of sales) {
    const name = s.responsibleName || '—';
    const row = ensure(map, name);
    row.salesCount = s._count;
    row.salesAmount = s._sum.totalAmount || 0;
    row.salesCost = s._sum.totalCost || 0;
  }

  const rows = Array.from(map.values()).map((r) => {
    r.salesProfit = r.salesAmount - r.salesCost;
    r.salesMargin = r.salesAmount > 0 ? r.salesProfit / r.salesAmount : 0;
    r.avgCheck = r.salesCount > 0 ? r.salesAmount / r.salesCount : 0;
    r.conversion = r.ordersAmount > 0 ? r.ordersPaid / r.ordersAmount : 0;
    return r;
  }).sort((a, b) => b.salesAmount - a.salesAmount);

  const totals = {
    ordersCount: rows.reduce((s, r) => s + r.ordersCount, 0),
    ordersAmount: rows.reduce((s, r) => s + r.ordersAmount, 0),
    ordersPaid: rows.reduce((s, r) => s + r.ordersPaid, 0),
    salesCount: rows.reduce((s, r) => s + r.salesCount, 0),
    salesAmount: rows.reduce((s, r) => s + r.salesAmount, 0),
    salesCost: rows.reduce((s, r) => s + r.salesCost, 0),
    salesProfit: rows.reduce((s, r) => s + r.salesProfit, 0),
  };

  return { from: opts.from, to: opts.to, totals, rows };
}

function ensure(map: Map<string, ManagerRow>, name: string): ManagerRow {
  let r = map.get(name);
  if (!r) {
    r = {
      name,
      ordersCount: 0, ordersAmount: 0, ordersPaid: 0,
      salesCount: 0, salesAmount: 0, salesCost: 0, salesProfit: 0, salesMargin: 0,
      avgCheck: 0, conversion: 0,
    };
    map.set(name, r);
  }
  return r;
}

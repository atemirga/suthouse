// Продажи по SKU и менеджерам — pivot позиция × ответственный.
// Источник: RealizaciaItem с подтянутым responsibleName из родительской реализации.

import { prisma } from '@/lib/db';

export interface SkuRow {
  nomenclatureId: string | null;
  name: string;
  totalQuantity: number;
  totalRevenue: number;
  totalCost: number;
  byManager: Record<string, { qty: number; revenue: number }>;
}

export interface SkuByManagerReport {
  from: Date;
  to: Date;
  managers: string[];
  rows: SkuRow[];
  totals: {
    revenue: number;
    quantity: number;
    cost: number;
    profit: number;
    byManager: Record<string, { qty: number; revenue: number }>;
  };
}

export async function buildSalesBySku(opts: { from: Date; to: Date; limit?: number }): Promise<SkuByManagerReport> {
  // Получаем все позиции с продажами + менеджером
  const items = await prisma.realizaciaItem.findMany({
    where: { realizacia: { posted: true, date: { gte: opts.from, lte: opts.to } } },
    select: {
      nomenclatureId: true,
      nomenclatureName: true,
      quantity: true,
      amount: true,
      costAmount: true,
      realizacia: { select: { responsibleName: true } },
    },
  });

  // Группируем
  const byKey = new Map<string, SkuRow>();
  const managerSet = new Set<string>();
  for (const it of items) {
    const key = it.nomenclatureId || it.nomenclatureName || '—';
    const mgr = it.realizacia.responsibleName || '—';
    managerSet.add(mgr);
    let row = byKey.get(key);
    if (!row) {
      row = {
        nomenclatureId: it.nomenclatureId,
        name: it.nomenclatureName || '—',
        totalQuantity: 0,
        totalRevenue: 0,
        totalCost: 0,
        byManager: {},
      };
      byKey.set(key, row);
    }
    row.totalQuantity += it.quantity;
    row.totalRevenue += it.amount;
    row.totalCost += it.costAmount;
    if (!row.byManager[mgr]) row.byManager[mgr] = { qty: 0, revenue: 0 };
    row.byManager[mgr].qty += it.quantity;
    row.byManager[mgr].revenue += it.amount;
  }

  const rows = Array.from(byKey.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  const managers = Array.from(managerSet).sort();

  const totalByManager: Record<string, { qty: number; revenue: number }> = {};
  for (const m of managers) totalByManager[m] = { qty: 0, revenue: 0 };
  let totalRevenue = 0, totalCost = 0, totalQty = 0;
  for (const r of rows) {
    totalRevenue += r.totalRevenue;
    totalCost += r.totalCost;
    totalQty += r.totalQuantity;
    for (const m of managers) {
      const v = r.byManager[m];
      if (v) {
        totalByManager[m].qty += v.qty;
        totalByManager[m].revenue += v.revenue;
      }
    }
  }

  return {
    from: opts.from,
    to: opts.to,
    managers,
    rows: opts.limit && opts.limit > 0 ? rows.slice(0, opts.limit) : rows,
    totals: {
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalRevenue - totalCost,
      quantity: totalQty,
      byManager: totalByManager,
    },
  };
}

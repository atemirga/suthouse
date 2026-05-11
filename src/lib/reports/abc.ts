// ABC-анализ номенклатуры по выручке (Парето 80/15/5).
//
// Метод: SKU сортируем по убыванию выбранного параметра, считаем накопительный
// процент. До 80% — класс A (главные деньги), 80–95% — B, остальное — C.
//
// Параметр анализа:
//   * 'revenue' — выручка
//   * 'profit'  — валовая прибыль (выручка − себестоимость FIFO)
//   * 'quantity' — количество (для логистики/закупа)

import { prisma } from '@/lib/db';

export type AbcParam = 'revenue' | 'profit' | 'quantity';

export interface AbcRow {
  nomenclatureId: string | null;
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  share: number;          // доля параметра анализа от итога
  cumShare: number;       // накопительная доля
  abcClass: 'A' | 'B' | 'C';
}

export interface AbcReport {
  param: AbcParam;
  from: Date;
  to: Date;
  totals: {
    revenue: number;
    cost: number;
    profit: number;
    quantity: number;
    skuCount: number;
  };
  classCounts: { A: number; B: number; C: number };
  classTotals: {
    A: { revenue: number; cost: number; profit: number; quantity: number };
    B: { revenue: number; cost: number; profit: number; quantity: number };
    C: { revenue: number; cost: number; profit: number; quantity: number };
  };
  rows: AbcRow[];
}

interface BuildOpts {
  from: Date;
  to: Date;
  param?: AbcParam;
  thresholdA?: number; // дефолт 80
  thresholdB?: number; // дефолт 95
  limit?: number;      // обрезать N топ для UI; 0 = все
}

export async function buildAbc(opts: BuildOpts): Promise<AbcReport> {
  const param: AbcParam = opts.param || 'revenue';
  const thA = opts.thresholdA ?? 80;
  const thB = opts.thresholdB ?? 95;

  const grouped = await prisma.realizaciaItem.groupBy({
    by: ['nomenclatureId', 'nomenclatureName'],
    where: { realizacia: { posted: true, date: { gte: opts.from, lte: opts.to } } },
    _sum: { amount: true, quantity: true, costAmount: true },
  });

  const rows: AbcRow[] = grouped.map((g) => {
    const revenue = g._sum.amount || 0;
    const cost = g._sum.costAmount || 0;
    const quantity = g._sum.quantity || 0;
    const profit = revenue - cost;
    const margin = revenue > 0 ? profit / revenue : 0;
    return {
      nomenclatureId: g.nomenclatureId,
      name: g.nomenclatureName || '—',
      quantity,
      revenue,
      cost,
      profit,
      margin,
      share: 0,
      cumShare: 0,
      abcClass: 'C',
    };
  });

  // Сортировка по параметру и расчёт долей.
  const valueOf = (r: AbcRow) =>
    param === 'revenue' ? r.revenue : param === 'profit' ? r.profit : r.quantity;

  rows.sort((a, b) => valueOf(b) - valueOf(a));

  const total = rows.reduce((s, r) => s + Math.max(0, valueOf(r)), 0);
  let cum = 0;
  const classCounts = { A: 0, B: 0, C: 0 };
  const classTotals = {
    A: { revenue: 0, cost: 0, profit: 0, quantity: 0 },
    B: { revenue: 0, cost: 0, profit: 0, quantity: 0 },
    C: { revenue: 0, cost: 0, profit: 0, quantity: 0 },
  };
  for (const r of rows) {
    const v = Math.max(0, valueOf(r));
    r.share = total > 0 ? (v / total) * 100 : 0;
    cum += r.share;
    r.cumShare = cum;
    if (r.cumShare <= thA) r.abcClass = 'A';
    else if (r.cumShare <= thB) r.abcClass = 'B';
    else r.abcClass = 'C';
    classCounts[r.abcClass]++;
    classTotals[r.abcClass].revenue += r.revenue;
    classTotals[r.abcClass].cost += r.cost;
    classTotals[r.abcClass].profit += r.profit;
    classTotals[r.abcClass].quantity += r.quantity;
  }

  const totals = {
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0),
    quantity: rows.reduce((s, r) => s + r.quantity, 0),
    skuCount: rows.length,
  };

  return {
    param,
    from: opts.from,
    to: opts.to,
    totals,
    classCounts,
    classTotals,
    rows: opts.limit && opts.limit > 0 ? rows.slice(0, opts.limit) : rows,
  };
}

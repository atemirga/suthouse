// ABC-анализ номенклатуры по Парето 80/15/5.
//
// Метод: SKU сортируем по убыванию выбранного параметра, считаем накопительный
// процент. До 80% — класс A (главные деньги), 80–95% — B, остальное — C.
//
// Параметр анализа:
//   * 'revenue'  — выручка
//   * 'profit'   — валовая прибыль (выручка − себестоимость)
//   * 'quantity' — масса в кг (в этом бизнесе все продукты весовые)
//
// СЕБЕСТОИМОСТЬ: используем factCost из 1С (источник истины, см.
// [[factcost-from-register]]). На уровне строки она недоступна — поэтому
// FIFO-cost каждой строки масштабируется коэффициентом factCost/totalCost
// родительской реализации. Fallback к чистому FIFO, если factCost не загружен.

import { prisma } from '@/lib/db';

export type AbcParam = 'revenue' | 'profit' | 'quantity';

export interface AbcRow {
  nomenclatureId: string | null;
  name: string;
  category: string | null;
  quantity: number;       // = кг (в этом бизнесе все продукты весовые)
  avgPrice: number;       // средняя цена ₸/кг
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
    quantity: number;     // кг
    skuCount: number;
    avgPrice: number;     // ₸/кг
    margin: number;       // средняя маржа
  };
  classCounts: { A: number; B: number; C: number };
  classTotals: {
    A: { revenue: number; cost: number; profit: number; quantity: number; skuCount: number };
    B: { revenue: number; cost: number; profit: number; quantity: number; skuCount: number };
    C: { revenue: number; cost: number; profit: number; quantity: number; skuCount: number };
  };
  rows: AbcRow[];
}

interface BuildOpts {
  from: Date;
  to: Date;
  param?: AbcParam;
  thresholdA?: number;
  thresholdB?: number;
  limit?: number;
}

interface SkuAggRow {
  nomenclatureId: string | null;
  nomenclatureName: string | null;
  quantity: number;
  amount: number;
  cost_adjusted: number;
}

export async function buildAbc(opts: BuildOpts): Promise<AbcReport> {
  const param: AbcParam = opts.param || 'revenue';
  const thA = opts.thresholdA ?? 80;
  const thB = opts.thresholdB ?? 95;

  // Агрегация на стороне БД: для каждой строки items стоимость масштабируется
  // коэффициентом factCost/totalCost родительской реализации. Где factCost
  // отсутствует или totalCost=0 — берём чистый costAmount (FIFO).
  const grouped = await prisma.$queryRaw<SkuAggRow[]>`
    SELECT
      ri."nomenclatureId",
      ri."nomenclatureName",
      SUM(ri.quantity)::float AS quantity,
      SUM(ri.amount)::float AS amount,
      SUM(
        CASE
          WHEN r."factCost" IS NOT NULL AND r."totalCost" > 0
            THEN ri."costAmount" * (r."factCost" / r."totalCost")
          ELSE ri."costAmount"
        END
      )::float AS cost_adjusted
    FROM "RealizaciaItem" ri
    JOIN "Realizacia" r ON r.id = ri."realizaciaId"
    WHERE r.posted = true
      AND r.date >= ${opts.from}
      AND r.date <= ${opts.to}
    GROUP BY ri."nomenclatureId", ri."nomenclatureName"
  `;

  // Категории номенклатуры — для дополнительной колонки в таблице
  const nomIds = grouped.map((g) => g.nomenclatureId).filter((x): x is string => !!x);
  const noms = nomIds.length
    ? await prisma.nomenclature.findMany({
        where: { id: { in: nomIds } },
        select: { id: true, categoryId: true },
      })
    : [];
  const catIds = Array.from(new Set(noms.map((n) => n.categoryId).filter((x): x is string => !!x)));
  const cats = catIds.length
    ? await prisma.nomenclatureCategory.findMany({
        where: { id: { in: catIds } },
        select: { id: true, name: true },
      })
    : [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const nomToCat = new Map(noms.map((n) => [n.id, n.categoryId ? catName.get(n.categoryId) || null : null]));

  const rows: AbcRow[] = grouped.map((g) => {
    const revenue = g.amount || 0;
    const cost = g.cost_adjusted || 0;
    const quantity = g.quantity || 0;
    const profit = revenue - cost;
    const margin = revenue > 0 ? profit / revenue : 0;
    const avgPrice = quantity > 0 ? revenue / quantity : 0;
    return {
      nomenclatureId: g.nomenclatureId,
      name: g.nomenclatureName || '—',
      category: g.nomenclatureId ? nomToCat.get(g.nomenclatureId) || null : null,
      quantity,
      avgPrice,
      revenue,
      cost,
      profit,
      margin,
      share: 0,
      cumShare: 0,
      abcClass: 'C',
    };
  });

  const valueOf = (r: AbcRow) =>
    param === 'revenue' ? r.revenue : param === 'profit' ? r.profit : r.quantity;

  rows.sort((a, b) => valueOf(b) - valueOf(a));

  const total = rows.reduce((s, r) => s + Math.max(0, valueOf(r)), 0);
  let cum = 0;
  const classCounts = { A: 0, B: 0, C: 0 };
  const classTotals = {
    A: { revenue: 0, cost: 0, profit: 0, quantity: 0, skuCount: 0 },
    B: { revenue: 0, cost: 0, profit: 0, quantity: 0, skuCount: 0 },
    C: { revenue: 0, cost: 0, profit: 0, quantity: 0, skuCount: 0 },
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
    classTotals[r.abcClass].skuCount++;
  }

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  const totalProfit = totalRevenue - totalCost;

  const totals = {
    revenue: totalRevenue,
    cost: totalCost,
    profit: totalProfit,
    quantity: totalQty,
    skuCount: rows.length,
    avgPrice: totalQty > 0 ? totalRevenue / totalQty : 0,
    margin: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
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

// Продажи по SKU и менеджерам — pivot позиция × ответственный из 1С.
//
// Источник: RealizaciaItem ← Realizacia (1С «Расходная накладная»). Это РЕАЛЬНО
// отгруженные позиции, не Заказы. Заказ может быть создан, но клиент мог
// передумать — нас интересует только то, что ушло «в расход» по факту.
//
// Себестоимость: масштабируется коэффициентом factCost/totalCost родительской
// реализации — это даёт правильную (1С-фактическую) cogs на уровне строки.
// См. [[factcost-from-register]].

import { prisma } from '@/lib/db';

export interface SkuRow {
  nomenclatureId: string | null;
  name: string;
  category: string | null;
  totalQuantity: number;     // в кг (все товары весовые)
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  margin: number;
  avgPrice: number;          // ₸/кг
  // прошлый период
  prevQuantity: number;
  prevRevenue: number;
  deltaRevenuePct: number;
  // pivot по менеджерам
  byManager: Record<string, { qty: number; revenue: number }>;
  // топ-5 контрагентов
  topKontragenty: { name: string; qty: number; revenue: number }[];
}

export interface SkuByManagerReport {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  managers: string[];
  rows: SkuRow[];
  totals: {
    revenue: number;
    quantity: number;
    cost: number;
    profit: number;
    margin: number;
    avgPrice: number;
    skuCount: number;
    byManager: Record<string, { qty: number; revenue: number }>;
  };
  prevTotals: { revenue: number; quantity: number };
}

interface BuildOpts {
  from: Date;
  to: Date;
  limit?: number;
  managerFilter?: string | null;
}

interface ItemAgg {
  nomenclatureId: string | null;
  nomenclatureName: string | null;
  responsibleName: string | null;
  kontragentName: string | null;
  quantity: number;
  amount: number;
  cost_adjusted: number;
}

export async function buildSalesBySku(opts: BuildOpts): Promise<SkuByManagerReport> {
  // 1. Период для сравнения — тот же размер, прилегающий
  const periodMs = opts.to.getTime() - opts.from.getTime();
  const prevTo = new Date(opts.from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  // 2. Текущий период — items с скалированной себестоимостью через factCost
  const [current, prev, nomsRaw] = await Promise.all([
    prisma.$queryRaw<ItemAgg[]>`
      SELECT
        ri."nomenclatureId",
        ri."nomenclatureName",
        r."responsibleName" AS "responsibleName",
        r."kontragentName" AS "kontragentName",
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
      GROUP BY ri."nomenclatureId", ri."nomenclatureName", r."responsibleName", r."kontragentName"
    `,
    prisma.$queryRaw<Array<{nomenclatureId: string | null; quantity: number; amount: number}>>`
      SELECT
        ri."nomenclatureId",
        SUM(ri.quantity)::float AS quantity,
        SUM(ri.amount)::float AS amount
      FROM "RealizaciaItem" ri
      JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.posted = true
        AND r.date >= ${prevFrom}
        AND r.date <= ${prevTo}
      GROUP BY ri."nomenclatureId"
    `,
    prisma.nomenclature.findMany({
      select: { id: true, categoryId: true },
    }),
  ]);

  // Категории номенклатуры
  const catIds = Array.from(new Set(nomsRaw.map((n) => n.categoryId).filter((x): x is string => !!x)));
  const cats = catIds.length
    ? await prisma.nomenclatureCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } })
    : [];
  const catNameMap = new Map(cats.map((c) => [c.id, c.name]));
  const nomToCat = new Map(nomsRaw.map((n) => [n.id, n.categoryId ? catNameMap.get(n.categoryId) || null : null]));

  // Prev по SKU
  const prevBySku = new Map<string | null, { qty: number; rev: number }>();
  for (const p of prev) prevBySku.set(p.nomenclatureId, { qty: p.quantity, rev: p.amount });

  // 3. Группируем по SKU + параллельно собираем менеджеров и контрагентов
  const byKey = new Map<string, SkuRow>();
  const managerSet = new Set<string>();
  for (const it of current) {
    const key = it.nomenclatureId || it.nomenclatureName || '—';
    const mgr = it.responsibleName || '—';
    const knt = it.kontragentName || '—';
    managerSet.add(mgr);

    let row = byKey.get(key);
    if (!row) {
      const prevP = prevBySku.get(it.nomenclatureId) || { qty: 0, rev: 0 };
      row = {
        nomenclatureId: it.nomenclatureId,
        name: it.nomenclatureName || '—',
        category: it.nomenclatureId ? nomToCat.get(it.nomenclatureId) || null : null,
        totalQuantity: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        margin: 0,
        avgPrice: 0,
        prevQuantity: prevP.qty,
        prevRevenue: prevP.rev,
        deltaRevenuePct: 0,
        byManager: {},
        topKontragenty: [],
      };
      byKey.set(key, row);
    }
    row.totalQuantity += it.quantity;
    row.totalRevenue += it.amount;
    row.totalCost += it.cost_adjusted;
    if (!row.byManager[mgr]) row.byManager[mgr] = { qty: 0, revenue: 0 };
    row.byManager[mgr].qty += it.quantity;
    row.byManager[mgr].revenue += it.amount;

    // Накапливаем kontragenty временно во вспомогательной map
    const k = (row as any)._kontMap as Map<string, { qty: number; revenue: number }> | undefined;
    if (!k) (row as any)._kontMap = new Map();
    const kMap: Map<string, { qty: number; revenue: number }> = (row as any)._kontMap;
    const ck = kMap.get(knt) || { qty: 0, revenue: 0 };
    ck.qty += it.quantity; ck.revenue += it.amount;
    kMap.set(knt, ck);
  }

  // 4. Финализация SKU-строк (производные значения + топ контрагенты)
  for (const row of byKey.values()) {
    row.totalProfit = row.totalRevenue - row.totalCost;
    row.margin = row.totalRevenue > 0 ? row.totalProfit / row.totalRevenue : 0;
    row.avgPrice = row.totalQuantity > 0 ? row.totalRevenue / row.totalQuantity : 0;
    row.deltaRevenuePct = row.prevRevenue > 0 ? ((row.totalRevenue - row.prevRevenue) / row.prevRevenue) * 100 : 0;

    const kMap: Map<string, { qty: number; revenue: number }> = (row as any)._kontMap || new Map();
    row.topKontragenty = Array.from(kMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    delete (row as any)._kontMap;
  }

  let rows = Array.from(byKey.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  if (opts.managerFilter) {
    rows = rows.filter((r) => r.byManager[opts.managerFilter!]);
  }
  const managers = Array.from(managerSet).sort();

  // Totals
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
  const totalProfit = totalRevenue - totalCost;

  const prevTotals = {
    revenue: prev.reduce((s, x) => s + x.amount, 0),
    quantity: prev.reduce((s, x) => s + x.quantity, 0),
  };

  return {
    from: opts.from,
    to: opts.to,
    prevFrom,
    prevTo,
    managers,
    rows: opts.limit && opts.limit > 0 ? rows.slice(0, opts.limit) : rows,
    totals: {
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalProfit,
      quantity: totalQty,
      margin: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
      avgPrice: totalQty > 0 ? totalRevenue / totalQty : 0,
      skuCount: rows.length,
      byManager: totalByManager,
    },
    prevTotals,
  };
}

// Drill-down: для конкретного SKU за период — детализация по менеджерам/датам/контрагентам
export async function drillSku(nomenclatureId: string, from: Date, to: Date) {
  const items = await prisma.realizaciaItem.findMany({
    where: {
      nomenclatureId,
      realizacia: { posted: true, date: { gte: from, lte: to } },
    },
    select: {
      quantity: true,
      amount: true,
      costAmount: true,
      realizacia: {
        select: { id: true, date: true, number: true, kontragentName: true, responsibleName: true, factCost: true, totalCost: true },
      },
    },
    orderBy: { realizacia: { date: 'desc' } },
    take: 1000,
  });
  // Скалированная себестоимость
  return items.map((it) => {
    const ratio = it.realizacia.factCost && it.realizacia.totalCost > 0
      ? it.realizacia.factCost / it.realizacia.totalCost
      : 1;
    const cost = it.costAmount * ratio;
    return {
      realizaciaId: it.realizacia.id,
      date: it.realizacia.date,
      number: it.realizacia.number,
      kontragent: it.realizacia.kontragentName,
      manager: it.realizacia.responsibleName,
      quantity: it.quantity,
      revenue: it.amount,
      cost,
      profit: it.amount - cost,
    };
  });
}

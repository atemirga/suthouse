// Продажи по категориям номенклатуры (Catalog_КатегорииНоменклатуры:
// Курт, Иримшик, Май и т.д.). Иерархия через NomenclatureCategory.parentId.
//
// Источник: RealizaciaItem ← Realizacia (1С Расходная накладная). Заказы НЕ
// учитываются — только фактическая отгрузка.
// Себестоимость: factCost-scaled (масштабирование FIFO коэффициентом
// factCost/totalCost родительской реализации). Это даёт правильную cogs
// на уровне строки, сходимую с ОПиУ.

import { prisma } from '@/lib/db';

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  quantity: number;   // = кг
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  avgPrice: number;
  prevRevenue: number;
  deltaRevenuePct: number;
  skuCount: number;
  children: CategoryNode[];
}

export interface CategoryReport {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  totals: {
    quantity: number; revenue: number; cost: number; profit: number;
    avgPrice: number; margin: number;
    prevRevenue: number; prevQuantity: number;
  };
  tree: CategoryNode[];
}

const NO_CATEGORY = '__no_category__';

interface ItemAggCurrent {
  nomenclatureId: string | null;
  quantity: number;
  amount: number;
  cost_adjusted: number;
}
interface ItemAggPrev {
  nomenclatureId: string | null;
  quantity: number;
  amount: number;
}

export async function buildSalesByCategory(opts: { from: Date; to: Date }): Promise<CategoryReport> {
  const periodMs = opts.to.getTime() - opts.from.getTime();
  const prevTo = new Date(opts.from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  const [current, prev, nomenclature, categories] = await Promise.all([
    prisma.$queryRaw<ItemAggCurrent[]>`
      SELECT
        ri."nomenclatureId",
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
      WHERE r.posted = true AND r.date >= ${opts.from} AND r.date <= ${opts.to}
      GROUP BY ri."nomenclatureId"
    `,
    prisma.$queryRaw<ItemAggPrev[]>`
      SELECT
        ri."nomenclatureId",
        SUM(ri.quantity)::float AS quantity,
        SUM(ri.amount)::float AS amount
      FROM "RealizaciaItem" ri
      JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.posted = true AND r.date >= ${prevFrom} AND r.date <= ${prevTo}
      GROUP BY ri."nomenclatureId"
    `,
    prisma.nomenclature.findMany({ select: { id: true, categoryId: true } }),
    prisma.nomenclatureCategory.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);

  const nomToCat = new Map<string, string | null>();
  for (const n of nomenclature) nomToCat.set(n.id, n.categoryId);

  const prevBySku = new Map<string | null, number>();
  for (const p of prev) prevBySku.set(p.nomenclatureId, p.amount);

  const nodes = new Map<string, CategoryNode>();
  function ensureCategory(id: string, name: string, parentId: string | null): CategoryNode {
    let n = nodes.get(id);
    if (!n) {
      n = {
        id, name, parentId, depth: 0,
        quantity: 0, revenue: 0, cost: 0, profit: 0, margin: 0, avgPrice: 0,
        prevRevenue: 0, deltaRevenuePct: 0, skuCount: 0, children: [],
      };
      nodes.set(id, n);
    }
    return n;
  }
  for (const c of categories) ensureCategory(c.id, c.name, c.parentId);
  ensureCategory(NO_CATEGORY, '— без категории —', null);

  // Аггрегация: поднимаем суммы по иерархии. Также считаем уникальные SKU
  // (counting only at the leaf level where category is directly assigned).
  const skuByCat = new Map<string, Set<string>>();
  for (const it of current) {
    if (!it.nomenclatureId) continue;
    const catId = nomToCat.get(it.nomenclatureId) || NO_CATEGORY;
    const rev = it.amount || 0;
    const qty = it.quantity || 0;
    const cost = it.cost_adjusted || 0;
    const prevRev = prevBySku.get(it.nomenclatureId) || 0;

    // Bubble up
    let cur: string | null = catId;
    while (cur) {
      const node = nodes.get(cur);
      if (!node) break;
      node.revenue += rev;
      node.quantity += qty;
      node.cost += cost;
      node.profit += rev - cost;
      node.prevRevenue += prevRev;
      cur = node.parentId;
    }

    // SKU count только на уровне самой категории (не bubble-up — иначе раздуем)
    if (!skuByCat.has(catId)) skuByCat.set(catId, new Set());
    skuByCat.get(catId)!.add(it.nomenclatureId);
  }
  for (const [catId, skus] of skuByCat.entries()) {
    const n = nodes.get(catId);
    if (n) n.skuCount = skus.size;
  }

  // Дети
  for (const n of nodes.values()) {
    if (n.parentId) {
      const parent = nodes.get(n.parentId);
      if (parent) parent.children.push(n);
    }
  }

  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    if (!n.parentId || !nodes.has(n.parentId)) roots.push(n);
  }

  function finalize(n: CategoryNode, depth: number) {
    n.depth = depth;
    n.margin = n.revenue > 0 ? n.profit / n.revenue : 0;
    n.avgPrice = n.quantity > 0 ? n.revenue / n.quantity : 0;
    n.deltaRevenuePct = n.prevRevenue > 0 ? ((n.revenue - n.prevRevenue) / n.prevRevenue) * 100 : 0;
    n.children.sort((a, b) => b.revenue - a.revenue);
    for (const c of n.children) finalize(c, depth + 1);
  }

  const activeRoots = roots.filter((r) => r.revenue > 0 || r.children.some((c) => c.revenue > 0));
  function pruneEmpty(n: CategoryNode) {
    n.children = n.children.filter((c) => c.revenue > 0);
    for (const c of n.children) pruneEmpty(c);
  }
  for (const r of activeRoots) pruneEmpty(r);

  activeRoots.sort((a, b) => b.revenue - a.revenue);
  for (const r of activeRoots) finalize(r, 0);

  const totalRevenue = activeRoots.reduce((s, n) => s + n.revenue, 0);
  const totalCost = activeRoots.reduce((s, n) => s + n.cost, 0);
  const totalQuantity = activeRoots.reduce((s, n) => s + n.quantity, 0);
  const totalProfit = totalRevenue - totalCost;
  const prevRevenue = activeRoots.reduce((s, n) => s + n.prevRevenue, 0);

  return {
    from: opts.from,
    to: opts.to,
    prevFrom,
    prevTo,
    totals: {
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalProfit,
      quantity: totalQuantity,
      avgPrice: totalQuantity > 0 ? totalRevenue / totalQuantity : 0,
      margin: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
      prevRevenue,
      prevQuantity: prev.reduce((s, p) => s + p.quantity, 0),
    },
    tree: activeRoots,
  };
}

// Drill-down: SKU в выбранной категории за период
export async function drillCategory(categoryId: string, from: Date, to: Date) {
  const noms = await prisma.nomenclature.findMany({
    where: categoryId === NO_CATEGORY
      ? { categoryId: null }
      : { categoryId },
    select: { id: true, name: true },
  });
  if (noms.length === 0) return [];
  const nomIds = noms.map((n) => n.id);
  // Для cost scaling: загружаем items + parent realizacii (factCost, totalCost)
  const itemsFull = await prisma.realizaciaItem.findMany({
    where: { nomenclatureId: { in: nomIds }, realizacia: { posted: true, date: { gte: from, lte: to } } },
    select: { nomenclatureId: true, quantity: true, amount: true, costAmount: true, realizacia: { select: { factCost: true, totalCost: true } } },
  });
  const skuMap = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
  for (const r of itemsFull) {
    if (!r.nomenclatureId) continue;
    const ratio = r.realizacia.factCost && r.realizacia.totalCost > 0
      ? r.realizacia.factCost / r.realizacia.totalCost
      : 1;
    const existing = skuMap.get(r.nomenclatureId) || { name: '', qty: 0, revenue: 0, cost: 0 };
    existing.qty += r.quantity;
    existing.revenue += r.amount;
    existing.cost += r.costAmount * ratio;
    skuMap.set(r.nomenclatureId, existing);
  }
  // Подтягиваем имена
  const nameMap = new Map(noms.map((n) => [n.id, n.name]));
  return Array.from(skuMap.entries())
    .map(([id, v]) => ({
      nomenclatureId: id,
      name: nameMap.get(id) || id,
      quantity: v.qty,
      revenue: v.revenue,
      cost: v.cost,
      profit: v.revenue - v.cost,
      margin: v.revenue > 0 ? (v.revenue - v.cost) / v.revenue : 0,
      avgPrice: v.qty > 0 ? v.revenue / v.qty : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Продажи по категориям номенклатуры.
// Источник: Catalog_КатегорииНоменклатуры (Курт, Иримшик, Май и т.д.) — настоящие
// управленческие категории. Связь через Nomenclature.categoryId.
// Иерархия категорий — через NomenclatureCategory.parentId.

import { prisma } from '@/lib/db';

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  children: CategoryNode[];
}

export interface CategoryReport {
  from: Date;
  to: Date;
  totals: { quantity: number; revenue: number; cost: number; profit: number };
  tree: CategoryNode[];
}

const NO_CATEGORY = '__no_category__';

export async function buildSalesByCategory(opts: { from: Date; to: Date }): Promise<CategoryReport> {
  const [items, nomenclature, categories] = await Promise.all([
    prisma.realizaciaItem.groupBy({
      by: ['nomenclatureId'],
      where: { realizacia: { posted: true, date: { gte: opts.from, lte: opts.to } } },
      _sum: { amount: true, quantity: true, costAmount: true },
    }),
    prisma.nomenclature.findMany({ select: { id: true, categoryId: true } }),
    prisma.nomenclatureCategory.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);

  const nomToCat = new Map<string, string | null>();
  for (const n of nomenclature) nomToCat.set(n.id, n.categoryId);

  // Узлы категорий
  const nodes = new Map<string, CategoryNode>();
  function ensureCategory(id: string, name: string, parentId: string | null): CategoryNode {
    let n = nodes.get(id);
    if (!n) {
      n = { id, name, parentId, depth: 0,
            quantity: 0, revenue: 0, cost: 0, profit: 0, margin: 0, children: [] };
      nodes.set(id, n);
    }
    return n;
  }

  // Заполняем все категории даже если без продаж — чтобы дерево было полным
  for (const c of categories) {
    ensureCategory(c.id, c.name, c.parentId);
  }
  ensureCategory(NO_CATEGORY, '— без категории —', null);

  // Аггрегация: для каждого nomenclatureId находим его категорию и поднимаем суммы
  // вверх по дереву.
  for (const it of items) {
    const nid = it.nomenclatureId;
    if (!nid) continue;
    const catId = nomToCat.get(nid) || NO_CATEGORY;
    const rev = it._sum.amount || 0;
    const qty = it._sum.quantity || 0;
    const cost = it._sum.costAmount || 0;

    let cur: string | null = catId;
    while (cur) {
      const node = nodes.get(cur);
      if (!node) break;
      node.revenue += rev;
      node.quantity += qty;
      node.cost += cost;
      node.profit += rev - cost;
      cur = node.parentId;
    }
  }

  // Привязываем детей к родителям
  for (const n of nodes.values()) {
    if (n.parentId) {
      const parent = nodes.get(n.parentId);
      if (parent) parent.children.push(n);
    }
  }

  // Корни — категории без родителя или с родителем-сиротой
  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    if (!n.parentId || !nodes.has(n.parentId)) roots.push(n);
  }

  function finalize(n: CategoryNode, depth: number) {
    n.depth = depth;
    n.margin = n.revenue > 0 ? n.profit / n.revenue : 0;
    n.children.sort((a, b) => b.revenue - a.revenue);
    for (const c of n.children) finalize(c, depth + 1);
  }

  // Скрываем категории с нулевыми продажами — оставляем только активные
  const activeRoots = roots.filter((r) => r.revenue > 0 || r.children.some((c) => c.revenue > 0));
  function pruneEmpty(n: CategoryNode) {
    n.children = n.children.filter((c) => c.revenue > 0);
    for (const c of n.children) pruneEmpty(c);
  }
  for (const r of activeRoots) pruneEmpty(r);

  activeRoots.sort((a, b) => b.revenue - a.revenue);
  for (const r of activeRoots) finalize(r, 0);

  const totals = {
    revenue: activeRoots.reduce((s, n) => s + n.revenue, 0),
    cost: activeRoots.reduce((s, n) => s + n.cost, 0),
    profit: activeRoots.reduce((s, n) => s + n.profit, 0),
    quantity: activeRoots.reduce((s, n) => s + n.quantity, 0),
  };

  return { from: opts.from, to: opts.to, totals, tree: activeRoots };
}

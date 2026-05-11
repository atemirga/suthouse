// Продажи по категориям номенклатуры. Использует иерархию через Nomenclature.parentId
// (в УНФ это группы и подгруппы). Поднимает суммы продаж позиций вверх по дереву.

import { prisma } from '@/lib/db';

export interface CategoryNode {
  id: string;          // nomenclatureId или 'root'
  name: string;
  parentId: string | null;
  isFolder: boolean;
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
  // Плоский список листьев (только товары, без папок) для CSV-экспорта при необходимости.
  // Не отдаём в UI — иерархия в UI.
}

export async function buildSalesByCategory(opts: { from: Date; to: Date }): Promise<CategoryReport> {
  const [items, nomenclature] = await Promise.all([
    prisma.realizaciaItem.groupBy({
      by: ['nomenclatureId'],
      where: { realizacia: { posted: true, date: { gte: opts.from, lte: opts.to } } },
      _sum: { amount: true, quantity: true, costAmount: true },
    }),
    prisma.nomenclature.findMany({ select: { id: true, name: true, parentId: true, isFolder: true } }),
  ]);

  // Карта Nomenclature
  const byId = new Map<string, { id: string; name: string; parentId: string | null; isFolder: boolean }>();
  for (const n of nomenclature) byId.set(n.id, n);

  // Узлы дерева; ключ = nomenclature id или 'unmapped'
  const nodes = new Map<string, CategoryNode>();
  function ensureNode(id: string, name: string, parentId: string | null, isFolder: boolean): CategoryNode {
    let n = nodes.get(id);
    if (!n) {
      n = { id, name, parentId, isFolder, depth: 0,
            quantity: 0, revenue: 0, cost: 0, profit: 0, margin: 0, children: [] };
      nodes.set(id, n);
    }
    return n;
  }

  // Заполняем узлы продаж и поднимаем по родителям
  for (const it of items) {
    const nid = it.nomenclatureId;
    if (!nid) continue;
    const meta = byId.get(nid);
    const name = meta?.name || `[${nid.slice(0, 8)}]`;
    const parentId = meta?.parentId || null;
    const leaf = ensureNode(nid, name, parentId, meta?.isFolder ?? false);
    const rev = it._sum.amount || 0;
    const qty = it._sum.quantity || 0;
    const cost = it._sum.costAmount || 0;
    leaf.revenue += rev;
    leaf.quantity += qty;
    leaf.cost += cost;
    leaf.profit += rev - cost;

    // Поднимаемся к корням
    let cur = parentId;
    while (cur) {
      const pm = byId.get(cur);
      if (!pm) break;
      const pn = ensureNode(cur, pm.name, pm.parentId, true);
      pn.revenue += rev;
      pn.quantity += qty;
      pn.cost += cost;
      pn.profit += rev - cost;
      cur = pm.parentId;
    }
  }

  // Привяжем детей к родителям
  for (const n of nodes.values()) {
    if (n.parentId) {
      const parent = nodes.get(n.parentId);
      if (parent) parent.children.push(n);
    }
  }

  // Корни
  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    if (!n.parentId || !nodes.has(n.parentId)) roots.push(n);
  }

  // Сортируем дерево и считаем margin + depth
  function finalize(n: CategoryNode, depth: number) {
    n.depth = depth;
    n.margin = n.revenue > 0 ? n.profit / n.revenue : 0;
    n.children.sort((a, b) => b.revenue - a.revenue);
    for (const c of n.children) finalize(c, depth + 1);
  }
  roots.sort((a, b) => b.revenue - a.revenue);
  for (const r of roots) finalize(r, 0);

  const totals = {
    revenue: roots.reduce((s, n) => s + n.revenue, 0),
    cost: roots.reduce((s, n) => s + n.cost, 0),
    profit: roots.reduce((s, n) => s + n.profit, 0),
    quantity: roots.reduce((s, n) => s + n.quantity, 0),
  };

  return { from: opts.from, to: opts.to, totals, tree: roots };
}

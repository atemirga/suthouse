// План-факт анализ продаж: сравнение SalesPlan с фактическими реализациями
// в периоде плана.

import { prisma } from '@/lib/db';

export interface PlanFactRow {
  id: string;
  scenarioName: string;
  startDate: Date;
  endDate: Date;
  scope: string;
  scopeId: string | null;
  scopeName: string | null;
  responsible: string | null;
  amountPlan: number;
  amountFact: number;
  amountDelta: number;
  amountPct: number; // факт/план * 100
  quantityPlan: number;
  quantityFact: number;
  quantityDelta: number;
  quantityPct: number;
  // Прогноз: линейная экстраполяция к концу периода если он не закончился.
  // Если период завершён — прогноз = факт.
  amountForecast: number;
  daysTotal: number;
  daysPassed: number;
}

export interface PlanFactReport {
  totals: { amountPlan: number; amountFact: number; deltaPct: number };
  rows: PlanFactRow[];
}

export async function buildPlanFact(): Promise<PlanFactReport> {
  const plans = await prisma.salesPlan.findMany({ orderBy: { startDate: 'desc' } });
  const now = new Date();

  const rows: PlanFactRow[] = await Promise.all(plans.map(async (p) => {
    const where: any = {
      posted: true,
      date: { gte: p.startDate, lte: p.endDate },
    };
    if (p.scope === 'manager' && p.scopeName) {
      where.responsibleName = p.scopeName;
    }
    let amountFact = 0;
    let quantityFact = 0;

    if (p.scope === 'total' || p.scope === 'manager') {
      const agg = await prisma.realizacia.aggregate({
        where, _sum: { totalAmount: true }, _count: true,
      });
      amountFact = agg._sum.totalAmount || 0;
    } else if (p.scope === 'category' && p.scopeId) {
      // scopeId = id NomenclatureCategory. Обходим дерево категорий вниз,
      // собираем все номенклатуры с любым из этих categoryId.
      const [allCats, allNomen] = await Promise.all([
        prisma.nomenclatureCategory.findMany({ select: { id: true, parentId: true } }),
        prisma.nomenclature.findMany({ select: { id: true, categoryId: true } }),
      ]);
      const childCats = new Map<string, string[]>();
      for (const c of allCats) {
        if (c.parentId) {
          let arr = childCats.get(c.parentId);
          if (!arr) { arr = []; childCats.set(c.parentId, arr); }
          arr.push(c.id);
        }
      }
      const catIds = new Set<string>();
      const stack = [p.scopeId];
      while (stack.length) {
        const cur = stack.pop()!;
        if (catIds.has(cur)) continue;
        catIds.add(cur);
        const ch = childCats.get(cur);
        if (ch) stack.push(...ch);
      }
      const nomIds = allNomen.filter((n) => n.categoryId && catIds.has(n.categoryId)).map((n) => n.id);
      const agg = await prisma.realizaciaItem.aggregate({
        where: {
          nomenclatureId: { in: nomIds },
          realizacia: { posted: true, date: { gte: p.startDate, lte: p.endDate } },
        },
        _sum: { amount: true, quantity: true },
      });
      amountFact = agg._sum.amount || 0;
      quantityFact = agg._sum.quantity || 0;
    } else if (p.scope === 'sku' && p.scopeId) {
      const agg = await prisma.realizaciaItem.aggregate({
        where: {
          nomenclatureId: p.scopeId,
          realizacia: { posted: true, date: { gte: p.startDate, lte: p.endDate } },
        },
        _sum: { amount: true, quantity: true },
      });
      amountFact = agg._sum.amount || 0;
      quantityFact = agg._sum.quantity || 0;
    }

    const daysTotal = Math.max(1, Math.ceil((p.endDate.getTime() - p.startDate.getTime()) / 86400000));
    const daysPassed = Math.max(1, Math.min(daysTotal,
      Math.ceil((Math.min(now.getTime(), p.endDate.getTime()) - p.startDate.getTime()) / 86400000)));
    const amountForecast = now < p.endDate
      ? amountFact * (daysTotal / daysPassed)
      : amountFact;

    return {
      id: p.id,
      scenarioName: p.scenarioName,
      startDate: p.startDate,
      endDate: p.endDate,
      scope: p.scope,
      scopeId: p.scopeId,
      scopeName: p.scopeName,
      responsible: p.responsible,
      amountPlan: p.amountPlan,
      amountFact: Math.round(amountFact * 100) / 100,
      amountDelta: Math.round((amountFact - p.amountPlan) * 100) / 100,
      amountPct: p.amountPlan > 0 ? (amountFact / p.amountPlan) * 100 : 0,
      quantityPlan: p.quantityPlan,
      quantityFact: Math.round(quantityFact * 1000) / 1000,
      quantityDelta: Math.round((quantityFact - p.quantityPlan) * 1000) / 1000,
      quantityPct: p.quantityPlan > 0 ? (quantityFact / p.quantityPlan) * 100 : 0,
      amountForecast: Math.round(amountForecast * 100) / 100,
      daysTotal,
      daysPassed,
    };
  }));

  const totalPlan = rows.reduce((s, r) => s + r.amountPlan, 0);
  const totalFact = rows.reduce((s, r) => s + r.amountFact, 0);
  return {
    totals: {
      amountPlan: totalPlan,
      amountFact: totalFact,
      deltaPct: totalPlan > 0 ? (totalFact / totalPlan) * 100 : 0,
    },
    rows,
  };
}

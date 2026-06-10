// Заказы менеджеров — сводка из двух источников: OrderBuyer (заказы) и
// Realizacia (фактические отгрузки). Дополнительно подтягиваем план продаж
// из SalesPlan со scope='manager' (если задан) и считаем кг отгрузок.
//
// Себестоимость берём через factCost (источник истины 1С), fallback на
// FIFO totalCost — это даёт корректную маржу, сходную с ОПиУ.

import { prisma } from '@/lib/db';

export interface ManagerRow {
  name: string;
  ordersCount: number;
  ordersAmount: number;
  ordersPaid: number;
  salesCount: number;
  salesAmount: number;
  salesKg: number;
  salesCost: number;
  salesProfit: number;
  salesMargin: number;
  avgCheck: number;
  conversion: number;
  // План
  planAmount: number;
  planKg: number;
  planAmountPct: number;       // факт / план * 100, по сумме
  planKgPct: number;           // факт / план * 100, по кг
  // Новые клиенты
  newClients: number;
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
    salesKg: number;
    salesCost: number;
    salesProfit: number;
    planAmount: number;
    planKg: number;
    newClients: number;
  };
  rows: ManagerRow[];
}

export async function buildOrdersByManager(opts: { from: Date; to: Date }): Promise<ManagerReport> {
  const [orders, sales, kgPerManager, plans, firstSales] = await Promise.all([
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
      _sum: { itemsAmount: true, factCost: true, totalCost: true },
    }),
    prisma.$queryRaw<Array<{responsibleName: string | null; quantity: number}>>`
      SELECT r."responsibleName" AS "responsibleName", SUM(ri.quantity)::float AS quantity
      FROM "RealizaciaItem" ri
      JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.posted = true AND r.date >= ${opts.from} AND r.date <= ${opts.to}
      GROUP BY r."responsibleName"
    `,
    // Планы для менеджеров с пересечением периода
    prisma.salesPlan.findMany({
      where: {
        scope: 'manager',
        startDate: { lte: opts.to },
        endDate: { gte: opts.from },
      },
      select: { scopeName: true, amountPlan: true, quantityPlan: true },
    }),
    // Дата первой покупки контрагента — для определения «новых клиентов»
    prisma.$queryRaw<Array<{kontragentId: string; firstDate: Date; firstManager: string | null}>>`
      SELECT
        r."kontragentId" AS "kontragentId",
        MIN(r.date) AS "firstDate",
        (array_agg(r."responsibleName" ORDER BY r.date ASC))[1] AS "firstManager"
      FROM "Realizacia" r
      WHERE r.posted = true AND r."kontragentId" IS NOT NULL
      GROUP BY r."kontragentId"
    `,
  ]);

  const kgMap = new Map<string, number>();
  for (const k of kgPerManager) if (k.responsibleName) kgMap.set(k.responsibleName, k.quantity);

  // План агрегирован по имени менеджера (если их несколько в одном периоде — сумма)
  const planByMgr = new Map<string, { amount: number; kg: number }>();
  for (const p of plans) {
    if (!p.scopeName) continue;
    const existing = planByMgr.get(p.scopeName) || { amount: 0, kg: 0 };
    existing.amount += p.amountPlan;
    existing.kg += p.quantityPlan;
    planByMgr.set(p.scopeName, existing);
  }

  // Новые клиенты по менеджеру (если первая покупка попала в наш период)
  const newClientsByMgr = new Map<string, number>();
  for (const f of firstSales) {
    if (!f.firstDate || !f.firstManager) continue;
    const d = new Date(f.firstDate);
    if (d >= opts.from && d <= opts.to) {
      newClientsByMgr.set(f.firstManager, (newClientsByMgr.get(f.firstManager) || 0) + 1);
    }
  }

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
    row.salesAmount = s._sum.itemsAmount || 0;
    row.salesCost = s._sum.factCost ?? s._sum.totalCost ?? 0;
    row.salesKg = kgMap.get(name) || 0;
  }

  // Параметры на основе плана и новых клиентов
  for (const row of map.values()) {
    const p = planByMgr.get(row.name);
    row.planAmount = p?.amount || 0;
    row.planKg = p?.kg || 0;
    row.planAmountPct = row.planAmount > 0 ? (row.salesAmount / row.planAmount) * 100 : 0;
    row.planKgPct = row.planKg > 0 ? (row.salesKg / row.planKg) * 100 : 0;
    row.newClients = newClientsByMgr.get(row.name) || 0;
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
    salesKg: rows.reduce((s, r) => s + r.salesKg, 0),
    salesCost: rows.reduce((s, r) => s + r.salesCost, 0),
    salesProfit: rows.reduce((s, r) => s + r.salesProfit, 0),
    planAmount: rows.reduce((s, r) => s + r.planAmount, 0),
    planKg: rows.reduce((s, r) => s + r.planKg, 0),
    newClients: rows.reduce((s, r) => s + r.newClients, 0),
  };

  return { from: opts.from, to: opts.to, totals, rows };
}

function ensure(map: Map<string, ManagerRow>, name: string): ManagerRow {
  let r = map.get(name);
  if (!r) {
    r = {
      name,
      ordersCount: 0, ordersAmount: 0, ordersPaid: 0,
      salesCount: 0, salesAmount: 0, salesKg: 0, salesCost: 0, salesProfit: 0, salesMargin: 0,
      avgCheck: 0, conversion: 0,
      planAmount: 0, planKg: 0, planAmountPct: 0, planKgPct: 0,
      newClients: 0,
    };
    map.set(name, r);
  }
  return r;
}

// Воронка продаж по источникам привлечения.
//
// Стадии: контрагенты с источником → у скольких есть заказ за период →
// у скольких есть продажа за период.
//
// Дополнительно отслеживаем «новых клиентов» — тех, у кого первая Realizacia
// попадает в текущий период (то есть пришли впервые именно сейчас).
//
// Все суммы считаем по `Realizacia` (1С Расходная накладная) — фактически
// отгруженное. Количество (кг) — из `RealizaciaItem.quantity`.

import { prisma } from '@/lib/db';

export interface FunnelStageRow {
  sourceId: string | null;
  sourceName: string;
  contractors: number;
  withOrder: number;
  withSale: number;
  newClients: number;            // клиентов, чья ПЕРВАЯ покупка в периоде
  newClientsRevenue: number;
  newClientsKg: number;
  revenue: number;
  kg: number;
  cost: number;
  profit: number;
  ordersCount: number;
  ordersAmount: number;
  avgCheck: number;
  convOrder: number;
  convSale: number;
  losses: number;
  lossesAmount: number;
}

export interface FunnelReport {
  from: Date;
  to: Date;
  rows: FunnelStageRow[];
  totals: Omit<FunnelStageRow, 'sourceId' | 'sourceName'> & {
    sourceId: null;
    sourceName: 'Итого';
  };
}

export async function buildFunnel(opts: { from: Date; to: Date }): Promise<FunnelReport> {
  const [sources, contractors, orders, sales, salesItems, firstSales] = await Promise.all([
    prisma.attractionSource.findMany(),
    prisma.kontragent.findMany({
      where: { isFolder: false },
      select: { id: true, attractionSourceId: true },
    }),
    prisma.orderBuyer.groupBy({
      by: ['kontragentId'],
      where: { posted: true, date: { gte: opts.from, lte: opts.to }, kontragentId: { not: null } },
      _count: true,
      _sum: { totalAmount: true },
    }),
    prisma.realizacia.groupBy({
      by: ['kontragentId'],
      where: { posted: true, date: { gte: opts.from, lte: opts.to }, kontragentId: { not: null } },
      _count: true,
      _sum: { itemsAmount: true, factCost: true, totalCost: true },
    }),
    // Сколько кг отгружено каждому контрагенту за период
    prisma.$queryRaw<Array<{kontragentId: string; quantity: number}>>`
      SELECT r."kontragentId" as "kontragentId", SUM(ri.quantity)::float AS quantity
      FROM "RealizaciaItem" ri
      JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.posted = true
        AND r.date >= ${opts.from} AND r.date <= ${opts.to}
        AND r."kontragentId" IS NOT NULL
      GROUP BY r."kontragentId"
    `,
    // Первая по времени покупка каждого контрагента — для определения «новых»
    prisma.realizacia.groupBy({
      by: ['kontragentId'],
      where: { posted: true, kontragentId: { not: null } },
      _min: { date: true },
    }),
  ]);

  const sourceById = new Map(sources.map((s) => [s.id, s.name]));
  const sourceByKont = new Map<string, string | null>();
  for (const k of contractors) sourceByKont.set(k.id, k.attractionSourceId);

  const kgByKont = new Map<string, number>();
  for (const r of salesItems) {
    if (r.kontragentId) kgByKont.set(r.kontragentId, r.quantity);
  }

  const firstSaleByKont = new Map<string, Date | null>();
  for (const f of firstSales) {
    if (f.kontragentId) firstSaleByKont.set(f.kontragentId, f._min.date);
  }
  function isNew(kid: string): boolean {
    const d = firstSaleByKont.get(kid);
    if (!d) return false;
    return d >= opts.from && d <= opts.to;
  }

  const ordersByKont = new Map<string, { count: number; amount: number }>();
  for (const o of orders) {
    if (!o.kontragentId) continue;
    ordersByKont.set(o.kontragentId, { count: o._count, amount: o._sum.totalAmount || 0 });
  }
  const salesByKont = new Map<string, { count: number; amount: number; cost: number }>();
  for (const s of sales) {
    if (!s.kontragentId) continue;
    // Используем factCost если есть, иначе totalCost (FIFO)
    const cost = s._sum.factCost ?? s._sum.totalCost ?? 0;
    salesByKont.set(s.kontragentId, {
      count: s._count,
      amount: s._sum.itemsAmount || 0,
      cost,
    });
  }

  type Bucket = {
    contractors: Set<string>;
    withOrderSet: Set<string>;
    withSaleSet: Set<string>;
    newClientsSet: Set<string>;
    newClientsRevenue: number;
    newClientsKg: number;
    revenue: number;
    kg: number;
    cost: number;
    ordersCount: number;
    ordersAmount: number;
    salesCount: number;
  };
  const buckets = new Map<string, Bucket>();
  function getBucket(key: string): Bucket {
    let b = buckets.get(key);
    if (!b) {
      b = {
        contractors: new Set(), withOrderSet: new Set(), withSaleSet: new Set(),
        newClientsSet: new Set(),
        newClientsRevenue: 0, newClientsKg: 0,
        revenue: 0, kg: 0, cost: 0,
        ordersCount: 0, ordersAmount: 0, salesCount: 0,
      };
      buckets.set(key, b);
    }
    return b;
  }

  for (const k of contractors) {
    const key = k.attractionSourceId || 'unknown';
    getBucket(key).contractors.add(k.id);
  }
  for (const [kid, o] of ordersByKont) {
    const sid = sourceByKont.get(kid) || 'unknown';
    const b = getBucket(sid);
    b.withOrderSet.add(kid);
    b.ordersCount += o.count;
    b.ordersAmount += o.amount;
  }
  for (const [kid, s] of salesByKont) {
    const sid = sourceByKont.get(kid) || 'unknown';
    const b = getBucket(sid);
    b.withSaleSet.add(kid);
    b.salesCount += s.count;
    b.revenue += s.amount;
    b.cost += s.cost;
    b.kg += kgByKont.get(kid) || 0;
    if (isNew(kid)) {
      b.newClientsSet.add(kid);
      b.newClientsRevenue += s.amount;
      b.newClientsKg += kgByKont.get(kid) || 0;
    }
  }

  const rows: FunnelStageRow[] = Array.from(buckets.entries()).map(([sid, b]) => {
    const losses = b.withOrderSet.size - b.withSaleSet.size;
    let lossesAmount = 0;
    for (const kid of b.withOrderSet) {
      if (!b.withSaleSet.has(kid)) lossesAmount += ordersByKont.get(kid)?.amount || 0;
    }
    return {
      sourceId: sid === 'unknown' ? null : sid,
      sourceName: sid === 'unknown' ? '— без источника —' : sourceById.get(sid) || sid,
      contractors: b.contractors.size,
      withOrder: b.withOrderSet.size,
      withSale: b.withSaleSet.size,
      newClients: b.newClientsSet.size,
      newClientsRevenue: b.newClientsRevenue,
      newClientsKg: b.newClientsKg,
      revenue: b.revenue,
      kg: b.kg,
      cost: b.cost,
      profit: b.revenue - b.cost,
      ordersCount: b.ordersCount,
      ordersAmount: b.ordersAmount,
      avgCheck: b.salesCount > 0 ? b.revenue / b.salesCount : 0,
      convOrder: b.contractors.size > 0 ? (b.withOrderSet.size / b.contractors.size) * 100 : 0,
      convSale: b.withOrderSet.size > 0 ? (b.withSaleSet.size / b.withOrderSet.size) * 100 : 0,
      losses,
      lossesAmount,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  const sum = (k: keyof FunnelStageRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const totalContractors = sum('contractors');
  const totalWithOrder = sum('withOrder');
  const totalWithSale = sum('withSale');
  const totalRevenue = sum('revenue');
  const totalSalesCount = rows.reduce((s, r) => s + (r.withSale > 0 ? r.withSale : 0), 0);
  const totals = {
    sourceId: null,
    sourceName: 'Итого' as const,
    contractors: totalContractors,
    withOrder: totalWithOrder,
    withSale: totalWithSale,
    newClients: sum('newClients'),
    newClientsRevenue: sum('newClientsRevenue'),
    newClientsKg: sum('newClientsKg'),
    revenue: totalRevenue,
    kg: sum('kg'),
    cost: sum('cost'),
    profit: totalRevenue - sum('cost'),
    ordersCount: sum('ordersCount'),
    ordersAmount: sum('ordersAmount'),
    avgCheck: totalSalesCount > 0 ? totalRevenue / totalSalesCount : 0,
    convOrder: totalContractors > 0 ? (totalWithOrder / totalContractors) * 100 : 0,
    convSale: totalWithOrder > 0 ? (totalWithSale / totalWithOrder) * 100 : 0,
    losses: sum('losses'),
    lossesAmount: sum('lossesAmount'),
  };

  return { from: opts.from, to: opts.to, rows, totals };
}

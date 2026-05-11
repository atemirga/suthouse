// Отчёт «Упаковщики ABC».
// В этой 1С УНФ KZ поле «Курьер_Key» в заказе используется как «упаковщик/сборщик»
// (тот, кто фактически собирает заказ к выдаче).

import { prisma } from '@/lib/db';

export interface PackerRow {
  name: string;
  ordersCount: number;
  ordersAmount: number;
  share: number;
  cumShare: number;
  abcClass: 'A' | 'B' | 'C';
}

export interface PackersReport {
  from: Date;
  to: Date;
  totals: { ordersCount: number; ordersAmount: number; packersCount: number };
  rows: PackerRow[];
}

export async function buildPackers(opts: { from: Date; to: Date }): Promise<PackersReport> {
  const grouped = await prisma.orderBuyer.groupBy({
    by: ['courierName'],
    where: {
      posted: true,
      date: { gte: opts.from, lte: opts.to },
      courierId: { not: null },
    },
    _count: true,
    _sum: { totalAmount: true },
  });

  const rows = grouped.map((g) => ({
    name: g.courierName || '—',
    ordersCount: g._count,
    ordersAmount: g._sum.totalAmount || 0,
    share: 0,
    cumShare: 0,
    abcClass: 'C' as 'A' | 'B' | 'C',
  })).sort((a, b) => b.ordersAmount - a.ordersAmount);

  const totalAmount = rows.reduce((s, r) => s + r.ordersAmount, 0);
  let cum = 0;
  for (const r of rows) {
    r.share = totalAmount > 0 ? (r.ordersAmount / totalAmount) * 100 : 0;
    cum += r.share;
    r.cumShare = cum;
    r.abcClass = r.cumShare <= 80 ? 'A' : r.cumShare <= 95 ? 'B' : 'C';
  }

  return {
    from: opts.from,
    to: opts.to,
    totals: {
      ordersCount: rows.reduce((s, r) => s + r.ordersCount, 0),
      ordersAmount: totalAmount,
      packersCount: rows.length,
    },
    rows,
  };
}

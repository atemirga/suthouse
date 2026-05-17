// Отчёт по упаковщикам. Источник — OrderBuyer.packerName, заполняется из 1С
// (доп.реквизит «Упаковщик» в Document_ЗаказПокупателя_ДополнительныеРеквизиты).
import { prisma } from '@/lib/db';

export interface PackerRow {
  name: string;
  ordersCount: number;     // всего заказов
  ordersAmount: number;    // на сумму
  avgOrder: number;
  share: number;           // доля по количеству, 0..1
}

export interface PackersReport {
  from: Date;
  to: Date;
  totals: { ordersCount: number; ordersAmount: number };
  rows: PackerRow[];
}

export async function buildPackersReport(opts: { from: Date; to: Date }): Promise<PackersReport> {
  const groups = await prisma.orderBuyer.groupBy({
    by: ['packerName'],
    where: { posted: true, date: { gte: opts.from, lte: opts.to } },
    _count: true,
    _sum: { totalAmount: true },
  });

  const rows: PackerRow[] = groups.map((g) => ({
    name: g.packerName || '— без упаковщика —',
    ordersCount: g._count,
    ordersAmount: g._sum.totalAmount || 0,
    avgOrder: g._count > 0 ? (g._sum.totalAmount || 0) / g._count : 0,
    share: 0,
  })).sort((a, b) => b.ordersCount - a.ordersCount);

  const totalCount = rows.reduce((s, r) => s + r.ordersCount, 0);
  const totalAmt = rows.reduce((s, r) => s + r.ordersAmount, 0);
  for (const r of rows) r.share = totalCount > 0 ? r.ordersCount / totalCount : 0;

  return {
    from: opts.from,
    to: opts.to,
    totals: { ordersCount: totalCount, ordersAmount: totalAmt },
    rows,
  };
}

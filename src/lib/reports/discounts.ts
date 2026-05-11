// Отчёт «Скидки» — все предоставленные скидки в реализациях.
// Источник: RealizaciaItem.discount (СуммаСкидкиНаценки в УНФ).

import { prisma } from '@/lib/db';

export interface DiscountByContractor {
  kontragentId: string | null;
  name: string;
  discountSum: number;
  revenue: number;
  documentsCount: number;
  pct: number; // discount / (revenue + discount)
}

export interface DiscountByItem {
  nomenclatureId: string | null;
  name: string;
  discountSum: number;
  revenue: number;
  pct: number;
}

export interface DiscountsReport {
  from: Date;
  to: Date;
  totals: { discount: number; revenue: number; documentsCount: number; itemsCount: number; pct: number };
  byContractor: DiscountByContractor[];
  byItem: DiscountByItem[];
  byManager: { name: string; discountSum: number; revenue: number; pct: number }[];
}

export async function buildDiscounts(opts: { from: Date; to: Date }): Promise<DiscountsReport> {
  const items = await prisma.realizaciaItem.findMany({
    where: {
      realizacia: { posted: true, date: { gte: opts.from, lte: opts.to } },
      discount: { gt: 0 },
    },
    select: {
      nomenclatureId: true, nomenclatureName: true,
      amount: true, discount: true,
      realizacia: { select: { id: true, kontragentId: true, kontragentName: true, responsibleName: true } },
    },
  });

  const byKMap = new Map<string, DiscountByContractor>();
  const byIMap = new Map<string, DiscountByItem>();
  const byMMap = new Map<string, { name: string; discountSum: number; revenue: number }>();
  const realIds = new Set<string>();

  let totalDiscount = 0, totalRevenue = 0;

  for (const it of items) {
    realIds.add(it.realizacia.id);
    const kid = it.realizacia.kontragentId || 'no-id';
    const kname = it.realizacia.kontragentName || '—';
    const mname = it.realizacia.responsibleName || '—';
    totalDiscount += it.discount;
    totalRevenue += it.amount;

    let kr = byKMap.get(kid);
    if (!kr) { kr = { kontragentId: it.realizacia.kontragentId, name: kname, discountSum: 0, revenue: 0, documentsCount: 0, pct: 0 }; byKMap.set(kid, kr); }
    kr.discountSum += it.discount;
    kr.revenue += it.amount;

    const ikey = it.nomenclatureId || it.nomenclatureName || '—';
    let ir = byIMap.get(ikey);
    if (!ir) { ir = { nomenclatureId: it.nomenclatureId, name: it.nomenclatureName || '—', discountSum: 0, revenue: 0, pct: 0 }; byIMap.set(ikey, ir); }
    ir.discountSum += it.discount;
    ir.revenue += it.amount;

    let mr = byMMap.get(mname);
    if (!mr) { mr = { name: mname, discountSum: 0, revenue: 0 }; byMMap.set(mname, mr); }
    mr.discountSum += it.discount;
    mr.revenue += it.amount;
  }

  // Подсчитаем кол-во документов на контрагента
  for (const r of byKMap.values()) {
    r.pct = r.revenue + r.discountSum > 0 ? (r.discountSum / (r.revenue + r.discountSum)) * 100 : 0;
  }
  // Узнаём кол-во документов на контрагента по уникальным realizacia.id, привязанным к контрагенту:
  // делаем дополнительный groupBy для точности.
  const docsByKont = await prisma.realizacia.groupBy({
    by: ['kontragentId'],
    where: { id: { in: Array.from(realIds) } },
    _count: true,
  });
  const docsMap = new Map(docsByKont.map((d) => [d.kontragentId || 'no-id', d._count]));
  for (const [kid, cr] of byKMap) cr.documentsCount = docsMap.get(kid) || 0;

  for (const r of byIMap.values()) {
    r.pct = r.revenue + r.discountSum > 0 ? (r.discountSum / (r.revenue + r.discountSum)) * 100 : 0;
  }

  const byManager = Array.from(byMMap.values())
    .map((m) => ({ ...m, pct: m.revenue + m.discountSum > 0 ? (m.discountSum / (m.revenue + m.discountSum)) * 100 : 0 }))
    .sort((a, b) => b.discountSum - a.discountSum);

  const byContractor = Array.from(byKMap.values()).sort((a, b) => b.discountSum - a.discountSum);
  const byItem = Array.from(byIMap.values()).sort((a, b) => b.discountSum - a.discountSum);

  return {
    from: opts.from, to: opts.to,
    totals: {
      discount: totalDiscount,
      revenue: totalRevenue,
      documentsCount: realIds.size,
      itemsCount: items.length,
      pct: totalRevenue + totalDiscount > 0 ? (totalDiscount / (totalRevenue + totalDiscount)) * 100 : 0,
    },
    byContractor,
    byItem,
    byManager,
  };
}

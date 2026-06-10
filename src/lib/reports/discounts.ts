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
  topManager: string | null;     // менеджер с наибольшей суммой скидки по этому клиенту
}

export interface DiscountByItem {
  nomenclatureId: string | null;
  name: string;
  discountSum: number;
  revenue: number;
  pct: number;
  topManager: string | null;
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
  // Доли менеджеров в скидках по клиенту/позиции — для определения «top author»
  const mgrByKont = new Map<string, Map<string, number>>();
  const mgrByItem = new Map<string, Map<string, number>>();

  let totalDiscount = 0, totalRevenue = 0;

  for (const it of items) {
    realIds.add(it.realizacia.id);
    const kid = it.realizacia.kontragentId || 'no-id';
    const kname = it.realizacia.kontragentName || '—';
    const mname = it.realizacia.responsibleName || '—';
    totalDiscount += it.discount;
    totalRevenue += it.amount;

    let kr = byKMap.get(kid);
    if (!kr) { kr = { kontragentId: it.realizacia.kontragentId, name: kname, discountSum: 0, revenue: 0, documentsCount: 0, pct: 0, topManager: null }; byKMap.set(kid, kr); }
    kr.discountSum += it.discount;
    kr.revenue += it.amount;

    const ikey = it.nomenclatureId || it.nomenclatureName || '—';
    let ir = byIMap.get(ikey);
    if (!ir) { ir = { nomenclatureId: it.nomenclatureId, name: it.nomenclatureName || '—', discountSum: 0, revenue: 0, pct: 0, topManager: null }; byIMap.set(ikey, ir); }
    ir.discountSum += it.discount;
    ir.revenue += it.amount;

    let mr = byMMap.get(mname);
    if (!mr) { mr = { name: mname, discountSum: 0, revenue: 0 }; byMMap.set(mname, mr); }
    mr.discountSum += it.discount;
    mr.revenue += it.amount;

    let kMgr = mgrByKont.get(kid);
    if (!kMgr) { kMgr = new Map(); mgrByKont.set(kid, kMgr); }
    kMgr.set(mname, (kMgr.get(mname) || 0) + it.discount);

    let iMgr = mgrByItem.get(ikey);
    if (!iMgr) { iMgr = new Map(); mgrByItem.set(ikey, iMgr); }
    iMgr.set(mname, (iMgr.get(mname) || 0) + it.discount);
  }

  // Определяем top-менеджера для каждого клиента/позиции
  function pickTop(m: Map<string, number>): string | null {
    let best: string | null = null; let bestSum = -1;
    for (const [name, sum] of m) {
      if (sum > bestSum) { bestSum = sum; best = name; }
    }
    return best && best !== '—' ? best : null;
  }
  for (const [kid, cr] of byKMap) cr.topManager = pickTop(mgrByKont.get(kid) || new Map());
  for (const [ikey, ir] of byIMap) ir.topManager = pickTop(mgrByItem.get(ikey) || new Map());

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

// Drill-down: для строки таблицы (контрагент/позиция/менеджер) — список
// расходных, в которых давалась скидка. Группируем items по realizacia.id —
// одна заявка с несколькими позициями со скидкой показывается одной строкой.
export interface DiscountDrillRow {
  realizaciaId: string;
  date: Date;
  number: string;
  kontragentName: string | null;
  responsibleName: string | null;
  discountSum: number;   // сумма скидки только по позициям, попадающим под фильтр
  revenue: number;       // выручка по тем же позициям (со скидкой)
  pct: number;           // discount / (revenue + discount), %
  itemsCount: number;    // количество позиций со скидкой в этом документе
}

interface DiscountDrillOpts {
  from: Date;
  to: Date;
  kontragentId?: string | null;   // 'no-id' = без контрагента
  nomenclatureId?: string | null; // ключ из byItem (= nomenclatureId или имя)
  nomenclatureName?: string | null; // используется если nomenclatureId null
  manager?: string | null;
}

export async function drillDiscounts(opts: DiscountDrillOpts): Promise<DiscountDrillRow[]> {
  const where: any = {
    realizacia: { posted: true, date: { gte: opts.from, lte: opts.to } },
    discount: { gt: 0 },
  };
  if (opts.kontragentId !== undefined && opts.kontragentId !== null) {
    if (opts.kontragentId === 'no-id') {
      where.realizacia.kontragentId = null;
    } else {
      where.realizacia.kontragentId = opts.kontragentId;
    }
  }
  if (opts.nomenclatureId !== undefined && opts.nomenclatureId !== null) {
    where.nomenclatureId = opts.nomenclatureId;
  } else if (opts.nomenclatureName) {
    where.nomenclatureName = opts.nomenclatureName;
  }
  if (opts.manager) {
    where.realizacia.responsibleName = opts.manager;
  }

  const items = await prisma.realizaciaItem.findMany({
    where,
    select: {
      amount: true, discount: true,
      realizacia: {
        select: {
          id: true, date: true, number: true,
          kontragentName: true, responsibleName: true,
        },
      },
    },
  });

  const byDoc = new Map<string, DiscountDrillRow>();
  for (const it of items) {
    const r = it.realizacia;
    let row = byDoc.get(r.id);
    if (!row) {
      row = {
        realizaciaId: r.id,
        date: r.date,
        number: r.number,
        kontragentName: r.kontragentName,
        responsibleName: r.responsibleName,
        discountSum: 0,
        revenue: 0,
        pct: 0,
        itemsCount: 0,
      };
      byDoc.set(r.id, row);
    }
    row.discountSum += it.discount;
    row.revenue += it.amount;
    row.itemsCount++;
  }
  const rows = Array.from(byDoc.values());
  for (const r of rows) {
    r.pct = r.revenue + r.discountSum > 0 ? (r.discountSum / (r.revenue + r.discountSum)) * 100 : 0;
  }
  rows.sort((a, b) => b.discountSum - a.discountSum);
  return rows;
}

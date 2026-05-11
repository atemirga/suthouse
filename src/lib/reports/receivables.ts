// Отчёт «Дебиторская задолженность» с AR Aging.
//
// Принцип:
// 1. По каждому контрагенту собираем все реализации (отгрузки) хронологически.
// 2. Собираем все ДДС-поступления от этого контрагента (direction=inflow, не transfer).
// 3. FIFO-погашение: старые платежи гасят старые отгрузки. Остаток непогашенных
//    отгрузок = текущий долг. Возраст каждой непогашенной части = дни от её даты
//    до asOf (по умолчанию сейчас).
// 4. Раскладываем остатки по корзинам 0-7 / 8-14 / 15-30 / 31-60 / 61+ дней.
//
// Замечание: переплата (платежи > отгрузки) считается как «авансы», в долг не
// попадает и показывается отдельным значением `prepayments` со знаком минус.

import { prisma } from '@/lib/db';

export const AGING_BUCKETS = [
  { key: 'b0_7',   label: '0–7 дн',   min: 0,  max: 7,   color: '#10b981' },
  { key: 'b8_14',  label: '8–14 дн',  min: 8,  max: 14,  color: '#84cc16' },
  { key: 'b15_30', label: '15–30 дн', min: 15, max: 30,  color: '#f59e0b' },
  { key: 'b31_60', label: '31–60 дн', min: 31, max: 60,  color: '#f97316' },
  { key: 'b61',    label: '61+ дн',   min: 61, max: Infinity, color: '#ef4444' },
] as const;

export type BucketKey = (typeof AGING_BUCKETS)[number]['key'];

function bucketOf(days: number): BucketKey {
  for (const b of AGING_BUCKETS) {
    if (days >= b.min && days <= b.max) return b.key;
  }
  return 'b61';
}

function emptyBuckets(): Record<BucketKey, number> {
  return { b0_7: 0, b8_14: 0, b15_30: 0, b31_60: 0, b61: 0 } as Record<BucketKey, number>;
}

export interface ReceivableRow {
  kontragentId: string;
  kontragentName: string;
  totalDebt: number;     // сумма непогашенного по этому контрагенту
  prepayment: number;    // переплата (если платежей > отгрузок) — со знаком +, чтобы не путать
  buckets: Record<BucketKey, number>;
  oldestDate: Date | null;
  oldestDays: number;    // возраст самой старой непогашенной отгрузки в днях
}

export interface ReceivablesReport {
  asOf: Date;
  totals: {
    debt: number;
    prepayments: number;
    debtorCount: number;
    overdue30Plus: number;
    buckets: Record<BucketKey, number>;
  };
  rows: ReceivableRow[];
}

interface BuildOpts {
  asOf?: Date;
  /** ограничить топ-N строк (для дашборда); 0 = без ограничения */
  limit?: number;
  /** только контрагенты с долгом > minDebt (отсекает копеечные округления) */
  minDebt?: number;
}

export async function buildReceivables(opts: BuildOpts = {}): Promise<ReceivablesReport> {
  const asOf = opts.asOf || new Date();
  const minDebt = opts.minDebt ?? 1;

  // Берём только проведённые документы. Возвраты от покупателя в zakupki не трогаем —
  // у них direction нет, это другой контур. AR строим только на основании реализаций
  // и ДДС-поступлений.
  const [realizations, payments, openings] = await Promise.all([
    prisma.realizacia.findMany({
      where: { posted: true, kontragentId: { not: null }, date: { lte: asOf } },
      select: { kontragentId: true, kontragentName: true, totalAmount: true, date: true, number: true },
      orderBy: { date: 'asc' },
    }),
    prisma.ddsDocument.findMany({
      where: {
        posted: true,
        direction: 'inflow',
        kontragentId: { not: null },
        date: { lte: asOf },
      },
      select: { kontragentId: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    }),
    // Opening balance из регистра 1С на дату начала окна синка.
    // Нужно чтобы дебиторка из старых отгрузок не терялась.
    prisma.openingBalance.findMany({
      where: { kind: 'ar' },
      select: { refId: true, refName: true, amount: true, asOfDate: true },
    }),
  ]);

  // Группируем
  type Shipment = { date: Date; amount: number; remaining: number; number: string };
  const shipMap = new Map<string, Shipment[]>();
  const nameMap = new Map<string, string>();

  // Opening balances идут в начало списка отгрузок как самая ранняя «отгрузка»
  // на дату opening. Отрицательные opening (= аванс получ.) добавятся как
  // дополнительные платежи в payMap ниже.
  const openingDate = openings[0]?.asOfDate || new Date(asOf.getTime() - 365 * 86400000);
  for (const o of openings) {
    if (o.amount > 0) {
      nameMap.set(o.refId, o.refName || '—');
      let arr = shipMap.get(o.refId);
      if (!arr) { arr = []; shipMap.set(o.refId, arr); }
      arr.push({ date: openingDate, amount: o.amount, remaining: o.amount, number: 'opening' });
    }
  }

  for (const r of realizations) {
    if (!r.kontragentId) continue;
    nameMap.set(r.kontragentId, r.kontragentName || '—');
    let arr = shipMap.get(r.kontragentId);
    if (!arr) { arr = []; shipMap.set(r.kontragentId, arr); }
    arr.push({ date: r.date, amount: r.totalAmount, remaining: r.totalAmount, number: r.number });
  }
  // Сортируем отгрузки внутри каждого контрагента по дате — opening попадёт в начало.
  for (const arr of shipMap.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  const payMap = new Map<string, number>();
  // Отрицательные opening = авансы покупателей на момент opening — это «уже полученные» платежи.
  for (const o of openings) {
    if (o.amount < 0) {
      payMap.set(o.refId, (payMap.get(o.refId) || 0) - o.amount);
      nameMap.set(o.refId, o.refName || nameMap.get(o.refId) || '—');
    }
  }
  for (const p of payments) {
    if (!p.kontragentId) continue;
    payMap.set(p.kontragentId, (payMap.get(p.kontragentId) || 0) + p.amount);
  }
  // Контрагенты, у которых есть платежи, но нет отгрузок — могут быть авансы;
  // показываем их как prepayment без долга.
  for (const kid of payMap.keys()) {
    if (!shipMap.has(kid)) shipMap.set(kid, []);
  }

  const rows: ReceivableRow[] = [];

  for (const [kontragentId, ships] of shipMap.entries()) {
    let payRemaining = payMap.get(kontragentId) || 0;
    // FIFO: старые платежи гасят старые отгрузки.
    for (const s of ships) {
      if (payRemaining <= 0) break;
      const applied = Math.min(payRemaining, s.remaining);
      s.remaining -= applied;
      payRemaining -= applied;
    }

    const buckets = emptyBuckets();
    let totalDebt = 0;
    let oldestDate: Date | null = null;
    let oldestDays = 0;
    for (const s of ships) {
      if (s.remaining <= 0.01) continue;
      const days = Math.max(0, Math.floor((asOf.getTime() - s.date.getTime()) / 86400000));
      const bk = bucketOf(days);
      buckets[bk] += s.remaining;
      totalDebt += s.remaining;
      if (!oldestDate || s.date < oldestDate) {
        oldestDate = s.date;
        oldestDays = days;
      }
    }
    const prepayment = payRemaining; // переплата (платежи остались)

    if (totalDebt < minDebt && prepayment < minDebt) continue;

    rows.push({
      kontragentId,
      kontragentName: nameMap.get(kontragentId) || '—',
      totalDebt: Math.round(totalDebt * 100) / 100,
      prepayment: Math.round(prepayment * 100) / 100,
      buckets,
      oldestDate,
      oldestDays,
    });
  }

  // Сортировка: сначала по сумме долга убыв., при равенстве — по возрасту.
  rows.sort((a, b) => {
    if (b.totalDebt !== a.totalDebt) return b.totalDebt - a.totalDebt;
    return b.oldestDays - a.oldestDays;
  });

  const totals = {
    debt: 0,
    prepayments: 0,
    debtorCount: 0,
    overdue30Plus: 0,
    buckets: emptyBuckets(),
  };
  for (const r of rows) {
    totals.debt += r.totalDebt;
    totals.prepayments += r.prepayment;
    if (r.totalDebt > 0) totals.debtorCount += 1;
    totals.overdue30Plus += r.buckets.b31_60 + r.buckets.b61;
    for (const bk of Object.keys(r.buckets) as BucketKey[]) {
      totals.buckets[bk] += r.buckets[bk];
    }
  }
  totals.debt = Math.round(totals.debt * 100) / 100;
  totals.prepayments = Math.round(totals.prepayments * 100) / 100;
  totals.overdue30Plus = Math.round(totals.overdue30Plus * 100) / 100;

  return {
    asOf,
    totals,
    rows: opts.limit && opts.limit > 0 ? rows.slice(0, opts.limit) : rows,
  };
}

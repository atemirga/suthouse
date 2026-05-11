// Кредиторская задолженность (АP) — зеркально дебиторке.
// Строится по: Закупки (мы получили товар, должны) − ДДС outflow (мы заплатили)
// + opening AP из регистра РасчетыСПоставщиками.
// FIFO: старые платежи поставщику гасят старые поступления.

import { prisma } from '@/lib/db';
import { AGING_BUCKETS, type BucketKey } from './receivables';

export interface PayableRow {
  kontragentId: string;
  kontragentName: string;
  totalDebt: number;     // мы должны (сумма непогашенных закупок + opening)
  prepayment: number;    // мы переплатили (аванс выданный)
  buckets: Record<BucketKey, number>;
  oldestDate: Date | null;
  oldestDays: number;
}

export interface PayablesReport {
  asOf: Date;
  totals: {
    debt: number;
    prepayments: number;
    creditorCount: number;
    overdue30Plus: number;
    buckets: Record<BucketKey, number>;
  };
  rows: PayableRow[];
}

function bucketOf(days: number): BucketKey {
  for (const b of AGING_BUCKETS) {
    if (days >= b.min && days <= b.max) return b.key;
  }
  return 'b61';
}

function emptyBuckets(): Record<BucketKey, number> {
  return { b0_7: 0, b8_14: 0, b15_30: 0, b31_60: 0, b61: 0 } as Record<BucketKey, number>;
}

export async function buildPayables(opts: { asOf?: Date; minDebt?: number; limit?: number } = {}): Promise<PayablesReport> {
  const asOf = opts.asOf || new Date();
  const minDebt = opts.minDebt ?? 1;

  const [purchases, payments, openings] = await Promise.all([
    prisma.zakupka.findMany({
      where: { posted: true, kontragentId: { not: null }, isReturn: false, date: { lte: asOf } },
      select: { kontragentId: true, kontragentName: true, totalAmount: true, date: true, number: true },
      orderBy: { date: 'asc' },
    }),
    prisma.ddsDocument.findMany({
      where: {
        posted: true,
        direction: 'outflow',
        kontragentId: { not: null },
        date: { lte: asOf },
      },
      select: { kontragentId: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    }),
    prisma.openingBalance.findMany({
      where: { kind: 'ap' },
      select: { refId: true, refName: true, amount: true, asOfDate: true },
    }),
  ]);

  type Purchase = { date: Date; amount: number; remaining: number; number: string };
  const purchMap = new Map<string, Purchase[]>();
  const nameMap = new Map<string, string>();

  const openingDate = openings[0]?.asOfDate || new Date(asOf.getTime() - 365 * 86400000);
  for (const o of openings) {
    if (o.amount > 0) {
      nameMap.set(o.refId, o.refName || '—');
      let arr = purchMap.get(o.refId);
      if (!arr) { arr = []; purchMap.set(o.refId, arr); }
      arr.push({ date: openingDate, amount: o.amount, remaining: o.amount, number: 'opening' });
    }
  }

  for (const p of purchases) {
    if (!p.kontragentId) continue;
    nameMap.set(p.kontragentId, p.kontragentName || '—');
    let arr = purchMap.get(p.kontragentId);
    if (!arr) { arr = []; purchMap.set(p.kontragentId, arr); }
    arr.push({ date: p.date, amount: p.totalAmount, remaining: p.totalAmount, number: p.number });
  }
  for (const arr of purchMap.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  const payMap = new Map<string, number>();
  for (const o of openings) {
    if (o.amount < 0) {
      // Аванс выданный поставщику = это уже как бы оплачено вперёд
      payMap.set(o.refId, (payMap.get(o.refId) || 0) - o.amount);
      nameMap.set(o.refId, o.refName || nameMap.get(o.refId) || '—');
    }
  }
  for (const p of payments) {
    if (!p.kontragentId) continue;
    payMap.set(p.kontragentId, (payMap.get(p.kontragentId) || 0) + p.amount);
  }

  for (const kid of payMap.keys()) {
    if (!purchMap.has(kid)) purchMap.set(kid, []);
  }

  const rows: PayableRow[] = [];
  for (const [kontragentId, purchs] of purchMap.entries()) {
    let payRemaining = payMap.get(kontragentId) || 0;
    for (const p of purchs) {
      if (payRemaining <= 0) break;
      const applied = Math.min(payRemaining, p.remaining);
      p.remaining -= applied;
      payRemaining -= applied;
    }

    const buckets = emptyBuckets();
    let totalDebt = 0;
    let oldestDate: Date | null = null;
    let oldestDays = 0;
    for (const p of purchs) {
      if (p.remaining <= 0.01) continue;
      const days = Math.max(0, Math.floor((asOf.getTime() - p.date.getTime()) / 86400000));
      const bk = bucketOf(days);
      buckets[bk] += p.remaining;
      totalDebt += p.remaining;
      if (!oldestDate || p.date < oldestDate) {
        oldestDate = p.date;
        oldestDays = days;
      }
    }
    const prepayment = payRemaining;
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

  rows.sort((a, b) => {
    if (b.totalDebt !== a.totalDebt) return b.totalDebt - a.totalDebt;
    return b.oldestDays - a.oldestDays;
  });

  const totals = {
    debt: 0, prepayments: 0, creditorCount: 0, overdue30Plus: 0,
    buckets: emptyBuckets(),
  };
  for (const r of rows) {
    totals.debt += r.totalDebt;
    totals.prepayments += r.prepayment;
    if (r.totalDebt > 0) totals.creditorCount++;
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

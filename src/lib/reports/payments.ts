// Реестр платежей — все ДДС-документы с фильтрами.

import { prisma } from '@/lib/db';

export interface PaymentRow {
  id: string;
  date: Date;
  number: string;
  docType: string;
  direction: 'inflow' | 'outflow' | 'transfer' | string;
  amount: number;
  commission: number;
  kontragentName: string | null;
  articleName: string | null;
  kassaName: string | null;
  kassaToName: string | null;
  accountName: string | null;
  comment: string | null;
  paymentPurpose: string | null;
}

export interface PaymentsReport {
  from: Date;
  to: Date;
  total: number;       // всего записей по фильтру
  rows: PaymentRow[];
  totals: {
    inflow: number;
    outflow: number;
    transfer: number;
    commission: number;
  };
}

interface BuildOpts {
  from: Date;
  to: Date;
  direction?: 'inflow' | 'outflow' | 'transfer' | 'all';
  kassaId?: string;
  accountId?: string;
  kontragentId?: string;
  search?: string;
  limit?: number;     // по умолчанию 500 для UI
}

export async function buildPayments(opts: BuildOpts): Promise<PaymentsReport> {
  const where: any = { date: { gte: opts.from, lte: opts.to } };
  if (opts.direction && opts.direction !== 'all') where.direction = opts.direction;
  if (opts.kassaId) where.kassaId = opts.kassaId;
  if (opts.accountId) where.accountId = opts.accountId;
  if (opts.kontragentId) where.kontragentId = opts.kontragentId;
  if (opts.search) {
    const q = opts.search.trim();
    where.OR = [
      { kontragentName: { contains: q, mode: 'insensitive' } },
      { articleName: { contains: q, mode: 'insensitive' } },
      { paymentPurpose: { contains: q, mode: 'insensitive' } },
      { comment: { contains: q, mode: 'insensitive' } },
      { number: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [total, rows, agg] = await Promise.all([
    prisma.ddsDocument.count({ where }),
    prisma.ddsDocument.findMany({
      where,
      orderBy: { date: 'desc' },
      take: opts.limit || 500,
      select: {
        id: true, date: true, number: true, docType: true, direction: true,
        amount: true, commission: true,
        kontragentName: true, articleName: true,
        kassaName: true, kassaToName: true, accountName: true,
        comment: true, paymentPurpose: true,
      },
    }),
    prisma.ddsDocument.groupBy({
      by: ['direction'],
      where,
      _sum: { amount: true, commission: true },
    }),
  ]);

  const totals = { inflow: 0, outflow: 0, transfer: 0, commission: 0 };
  for (const a of agg) {
    if (a.direction === 'inflow') totals.inflow = a._sum.amount || 0;
    else if (a.direction === 'outflow') totals.outflow = a._sum.amount || 0;
    else if (a.direction === 'transfer') totals.transfer = a._sum.amount || 0;
    totals.commission += a._sum.commission || 0;
  }

  return { from: opts.from, to: opts.to, total, rows, totals };
}

export async function listKassasAndAccounts() {
  const [kassas, banks] = await Promise.all([
    prisma.kassa.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.bankAccount.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return { kassas, banks };
}

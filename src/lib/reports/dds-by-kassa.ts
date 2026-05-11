// ДДС по кассам — отчёт «Денежные средства в кассе» как в 1С УНФ.
// Колонки: Начальный остаток · Поступление · Расход · Конечный остаток.
// Перемещения между кассами учитываются как Поступление на одной стороне и
// Расход на другой (соответствует 1С ДДС-Касса).

import { prisma } from '@/lib/db';

export interface KassaRow {
  id: string;
  name: string;
  type: 'kassa' | 'bank';
  openingBalance: number;
  inflow: number;
  outflow: number;
  closingBalance: number;
}

export interface DdsByKassaReport {
  from: Date;
  to: Date;
  rows: KassaRow[];
  totals: { openingBalance: number; inflow: number; outflow: number; closingBalance: number };
}

export async function buildDdsByKassa(opts: { from: Date; to: Date }): Promise<DdsByKassaReport> {
  const [openings, allBefore, inPeriod] = await Promise.all([
    prisma.openingBalance.findMany({
      where: { kind: 'cash' },
      select: { refId: true, refName: true, refType: true, amount: true },
    }),
    // Все движения ДО начала периода — для вычисления опенинга периода
    prisma.ddsDocument.findMany({
      where: { date: { lt: opts.from } },
      select: {
        docType: true, direction: true, amount: true,
        kassaId: true, kassaName: true,
        kassaToId: true, kassaToName: true,
        accountId: true, accountName: true,
      },
    }),
    prisma.ddsDocument.findMany({
      where: { date: { gte: opts.from, lte: opts.to } },
      select: {
        docType: true, direction: true, amount: true,
        kassaId: true, kassaName: true,
        kassaToId: true, kassaToName: true,
        accountId: true, accountName: true,
      },
    }),
  ]);

  // Map: refId → KassaRow
  const map = new Map<string, KassaRow>();
  function ensure(id: string, name: string | null, type: 'kassa' | 'bank'): KassaRow {
    let r = map.get(id);
    if (!r) {
      r = { id, name: name || '—', type, openingBalance: 0, inflow: 0, outflow: 0, closingBalance: 0 };
      map.set(id, r);
    } else if (name && (!r.name || r.name === '—')) {
      r.name = name;
    }
    return r;
  }

  // Применяем opening balances
  for (const o of openings) {
    const r = ensure(o.refId, o.refName, (o.refType as 'kassa' | 'bank') || 'kassa');
    r.openingBalance += o.amount;
  }

  // Накатываем движения ДО периода в opening
  function applyToOpening(d: typeof allBefore[number]) {
    if (d.docType === 'PeremeschenieDC') {
      if (d.kassaId) {
        const r = ensure(d.kassaId, d.kassaName, 'kassa');
        r.openingBalance -= d.amount;
      }
      if (d.kassaToId) {
        const r = ensure(d.kassaToId, d.kassaToName, 'kassa');
        r.openingBalance += d.amount;
      }
      return;
    }
    const sign = d.direction === 'inflow' ? 1 : d.direction === 'outflow' ? -1 : 0;
    if (sign === 0) return;
    if (d.kassaId) {
      const r = ensure(d.kassaId, d.kassaName, 'kassa');
      r.openingBalance += sign * d.amount;
    }
    if (d.accountId) {
      const r = ensure(d.accountId, d.accountName, 'bank');
      r.openingBalance += sign * d.amount;
    }
  }
  for (const d of allBefore) applyToOpening(d);

  // Движения В периоде
  for (const d of inPeriod) {
    if (d.docType === 'PeremeschenieDC') {
      if (d.kassaId) {
        const r = ensure(d.kassaId, d.kassaName, 'kassa');
        r.outflow += d.amount;
      }
      if (d.kassaToId) {
        const r = ensure(d.kassaToId, d.kassaToName, 'kassa');
        r.inflow += d.amount;
      }
      continue;
    }
    if (d.direction === 'inflow') {
      if (d.kassaId) ensure(d.kassaId, d.kassaName, 'kassa').inflow += d.amount;
      if (d.accountId) ensure(d.accountId, d.accountName, 'bank').inflow += d.amount;
    } else if (d.direction === 'outflow') {
      if (d.kassaId) ensure(d.kassaId, d.kassaName, 'kassa').outflow += d.amount;
      if (d.accountId) ensure(d.accountId, d.accountName, 'bank').outflow += d.amount;
    }
  }

  // closing = opening + inflow − outflow
  for (const r of map.values()) {
    r.closingBalance = r.openingBalance + r.inflow - r.outflow;
  }

  const rows = Array.from(map.values())
    .filter((r) => Math.abs(r.openingBalance) > 0.5 || Math.abs(r.inflow) > 0.5 || Math.abs(r.outflow) > 0.5 || Math.abs(r.closingBalance) > 0.5)
    .sort((a, b) => b.closingBalance - a.closingBalance);

  const totals = {
    openingBalance: rows.reduce((s, r) => s + r.openingBalance, 0),
    inflow: rows.reduce((s, r) => s + r.inflow, 0),
    outflow: rows.reduce((s, r) => s + r.outflow, 0),
    closingBalance: rows.reduce((s, r) => s + r.closingBalance, 0),
  };

  return { from: opts.from, to: opts.to, rows, totals };
}

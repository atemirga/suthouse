// Общий расчёт остатков по кассам и банковским счетам.
//
// Логика идентична dds-by-kassa.ts: opening + изменения по каждому документу
// с правильной маршрутизацией transfer-докуменьтов по docType. Без этого
// transfer-документы (`ВзносНаличнымиВБанк`, `ПолучениеНаличныхВБанке`,
// `ПереводНаДругойСчет`) выпадают полностью — у них direction='transfer',
// sign=0, и старый код их игнорировал.

import { prisma } from '@/lib/db';

export interface CashPosition {
  id: string;
  name: string;
  type: 'kassa' | 'bank';
  balance: number;
}

type DocRow = {
  docType: string;
  direction: string;
  amount: number;
  kassaId: string | null;
  kassaName: string | null;
  kassaToId: string | null;
  kassaToName: string | null;
  accountId: string | null;
  accountName: string | null;
  accountToId: string | null;
  accountToName: string | null;
};

const SELECT_FIELDS = {
  docType: true, direction: true, amount: true,
  kassaId: true, kassaName: true,
  kassaToId: true, kassaToName: true,
  accountId: true, accountName: true,
  accountToId: true, accountToName: true,
} as const;

/**
 * Считает остатки по кассам/счетам на дату asOf.
 * Возвращает только позиции с |balance| > 1 ₸.
 */
export async function buildCashPositions(asOf: Date): Promise<CashPosition[]> {
  const [openings, allDds] = await Promise.all([
    prisma.openingBalance.findMany({
      where: { kind: 'cash' },
      select: { refId: true, refName: true, refType: true, amount: true },
    }),
    prisma.ddsDocument.findMany({
      where: { posted: true, date: { lte: asOf } },
      select: SELECT_FIELDS,
    }),
  ]);

  const map = new Map<string, CashPosition>();
  function ensure(id: string, name: string | null, type: 'kassa' | 'bank'): CashPosition {
    let r = map.get(id);
    if (!r) {
      r = { id, name: name || '—', type, balance: 0 };
      map.set(id, r);
    } else if (name && (!r.name || r.name === '—')) {
      r.name = name;
    }
    return r;
  }

  for (const o of openings) {
    ensure(o.refId, o.refName, (o.refType as 'kassa' | 'bank') || 'kassa').balance += o.amount;
  }

  function add(refId: string | null, refName: string | null, type: 'kassa' | 'bank', delta: number) {
    if (!refId || delta === 0) return;
    ensure(refId, refName, type).balance += delta;
  }

  for (const d of allDds as DocRow[]) {
    if (d.direction !== 'transfer') {
      const sign = d.direction === 'inflow' ? 1 : d.direction === 'outflow' ? -1 : 0;
      if (sign === 0) continue;
      add(d.kassaId, d.kassaName, 'kassa', sign * d.amount);
      add(d.accountId, d.accountName, 'bank', sign * d.amount);
      continue;
    }
    // Transfer: маршрутизация по docType (см. комментарий в schema.prisma).
    switch (d.docType) {
      case 'PeremeschenieDC':
        add(d.kassaId, d.kassaName, 'kassa', -d.amount);
        add(d.accountId, d.accountName, 'bank', -d.amount);
        add(d.kassaToId, d.kassaToName, 'kassa', d.amount);
        add(d.accountToId, d.accountToName, 'bank', d.amount);
        break;
      case 'RashodIzKassy':
        // ВзносНаличнымиВБанк: kassa OUT, account IN.
        add(d.kassaId, d.kassaName, 'kassa', -d.amount);
        add(d.accountId, d.accountName, 'bank', +d.amount);
        break;
      case 'PostuplenieVKassu':
        // ПолучениеНаличныхВБанке: kassa IN, account OUT.
        add(d.kassaId, d.kassaName, 'kassa', +d.amount);
        add(d.accountId, d.accountName, 'bank', -d.amount);
        break;
      case 'RashodSoScheta':
        // ПереводНаДругойСчет: account OUT, accountTo IN.
        add(d.accountId, d.accountName, 'bank', -d.amount);
        add(d.accountToId, d.accountToName, 'bank', +d.amount);
        break;
      case 'PostuplenieNaSchet':
        // ПолучениеВзаймы и т.п.: односторонний account IN.
        add(d.accountId, d.accountName, 'bank', +d.amount);
        break;
    }
  }

  return Array.from(map.values())
    .filter((p) => Math.abs(p.balance) > 1)
    .sort((a, b) => b.balance - a.balance);
}

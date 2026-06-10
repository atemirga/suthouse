// ДДС по кассам — отчёт «Денежные средства в кассе» как в 1С УНФ.
// Колонки: Начальный остаток · Поступление · Расход · Конечный остаток.
//
// Перемещения денежных средств (direction='transfer') учитываются с ОБЕИХ
// сторон через сохранённые в sync поля kassaId/kassaToId/accountId/accountToId.
// Маршрутизация по docType:
//   PeremeschenieDC                     source = kassaId|accountId,
//                                       dest   = kassaToId|accountToId
//   RashodIzKassy + ВзносНаличнымиВБанк kassa OUT, account IN
//   PostuplenieVKassu + ПолучениеНаличныхВБанке  account OUT, kassa IN
//   PostuplenieVKassu + ПолучениеВзаймы          kassa IN  (односторонне)
//   RashodSoScheta + ПереводНаДругойСчет         account OUT, accountTo IN
//   PostuplenieNaSchet + ПолучениеВзаймы         account IN (односторонне)

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

export async function buildDdsByKassa(opts: { from: Date; to: Date }): Promise<DdsByKassaReport> {
  const [openings, allBefore, inPeriod] = await Promise.all([
    prisma.openingBalance.findMany({
      where: { kind: 'cash' },
      select: { refId: true, refName: true, refType: true, amount: true },
    }),
    prisma.ddsDocument.findMany({
      where: { date: { lt: opts.from } },
      select: SELECT_FIELDS,
    }),
    prisma.ddsDocument.findMany({
      where: { date: { gte: opts.from, lte: opts.to } },
      select: SELECT_FIELDS,
    }),
  ]);

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

  // Opening из 1С (на asOfDate)
  for (const o of openings) {
    const r = ensure(o.refId, o.refName, (o.refType as 'kassa' | 'bank') || 'kassa');
    r.openingBalance += o.amount;
  }

  // Применить движение документа к refId. Положительный delta = приход на счёт,
  // отрицательный = расход. В opening — копится в openingBalance; в периоде —
  // раскладывается на inflow/outflow.
  function add(target: 'opening' | 'period', refId: string | null, refName: string | null, type: 'kassa' | 'bank', delta: number) {
    if (!refId || delta === 0) return;
    const r = ensure(refId, refName, type);
    if (target === 'opening') {
      r.openingBalance += delta;
    } else if (delta > 0) {
      r.inflow += delta;
    } else {
      r.outflow += -delta;
    }
  }

  function applyDoc(d: DocRow, target: 'opening' | 'period') {
    // Не-transfer: одна сторона документа (kassa или account), знак = direction.
    if (d.direction !== 'transfer') {
      const sign = d.direction === 'inflow' ? 1 : d.direction === 'outflow' ? -1 : 0;
      if (sign === 0) return;
      add(target, d.kassaId, d.kassaName, 'kassa', sign * d.amount);
      add(target, d.accountId, d.accountName, 'bank', sign * d.amount);
      return;
    }
    // Transfer: маршрутизация по docType.
    switch (d.docType) {
      case 'PeremeschenieDC':
        // Источник: kassaId либо accountId (в зависимости от ТипДенежныхСредств,
        // sync проставляет ровно одно из двух). Получатель: kassaToId либо accountToId.
        add(target, d.kassaId, d.kassaName, 'kassa', -d.amount);
        add(target, d.accountId, d.accountName, 'bank', -d.amount);
        add(target, d.kassaToId, d.kassaToName, 'kassa', d.amount);
        add(target, d.accountToId, d.accountToName, 'bank', d.amount);
        return;
      case 'RashodIzKassy':
        // ВзносНаличнымиВБанк: kassa OUT, account IN.
        add(target, d.kassaId, d.kassaName, 'kassa', -d.amount);
        add(target, d.accountId, d.accountName, 'bank', +d.amount);
        return;
      case 'PostuplenieVKassu':
        // ПолучениеНаличныхВБанке: kassa IN, account OUT.
        // ПолучениеВзаймы (accountId=null): односторонний kassa IN.
        add(target, d.kassaId, d.kassaName, 'kassa', +d.amount);
        add(target, d.accountId, d.accountName, 'bank', -d.amount);
        return;
      case 'RashodSoScheta':
        // ПереводНаДругойСчет: account OUT, accountTo IN.
        add(target, d.accountId, d.accountName, 'bank', -d.amount);
        add(target, d.accountToId, d.accountToName, 'bank', +d.amount);
        return;
      case 'PostuplenieNaSchet':
        // ПолучениеВзаймы и т.п.: односторонний account IN.
        add(target, d.accountId, d.accountName, 'bank', +d.amount);
        return;
    }
  }

  for (const d of allBefore) applyDoc(d, 'opening');
  for (const d of inPeriod) applyDoc(d, 'period');

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

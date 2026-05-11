// Sync opening balances from 1С AccumulationRegisters at sync window start date.
//
// Без этого «остаток денег» и «дебиторка» нельзя корректно посчитать — наши
// данные начинаются с какой-то даты (обычно — последний год), а реальные
// сальдо накоплены с основания компании.
//
// Запрашивает Balance(Period=...) три регистра:
//   * AccumulationRegister_ДенежныеСредства — остатки по кассам/счетам
//   * AccumulationRegister_РасчетыСПокупателями — нам должны (или авансы)
//   * AccumulationRegister_РасчетыСПоставщиками — мы должны (или авансы)
//
// Дата = MIN(date) из синкнутых документов (DDS+Realizacia+Zakupka) − 1 секунда.
// Если данных ещё нет — берём сейчас минус SYNC_DAYS_BACK.

import { prisma } from '@/lib/db';

const BASE_URL = (process.env.ODATA_URL || '').replace(/\/$/, '');
const LOGIN = process.env.ODATA_LOGIN || '';
const PASSWORD = process.env.ODATA_PASSWORD || '';
const authHeader = 'Basic ' + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

const baseHeaders = {
  Accept: 'application/json;odata=nometadata',
  Authorization: authHeader,
};

interface CashRow {
  БанковскийСчетКасса: string;
  БанковскийСчетКасса_Type?: string;
  ТипДенежныхСредств?: string;
  СуммаBalance?: number;
  СуммаВалBalance?: number;
}

interface SettlementRow {
  Контрагент_Key?: string;
  ТипРасчетов?: string; // "Долг" | "Аванс"
  СуммаBalance?: number;
  СуммаВалBalance?: number;
  СуммаРегBalance?: number;
}

async function fetchBalance<T>(register: string, period: Date): Promise<T[]> {
  // Дата в формате 1С datetime'YYYY-MM-DDTHH:MM:SS'
  const iso = period.toISOString().slice(0, 19);
  const url = `${BASE_URL}/${register}/Balance(Period=datetime'${iso}')?$format=json`;
  const resp = await fetch(url, { headers: baseHeaders });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OData ${register}/Balance ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { value?: T[] };
  return data.value || [];
}

async function computeAsOfDate(): Promise<Date> {
  // Берём минимальную дату по всем синкнутым документам и вычитаем 1 миллисекунду.
  const [r, z, d] = await Promise.all([
    prisma.realizacia.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
    prisma.zakupka.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
    prisma.ddsDocument.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
  ]);
  const dates = [r?.date, z?.date, d?.date].filter((x): x is Date => !!x);
  if (dates.length === 0) {
    // Fallback — текущая дата минус SYNC_DAYS_BACK
    const days = Number(process.env.SYNC_DAYS_BACK || 365);
    const fallback = new Date(Date.now() - days * 86400000);
    fallback.setHours(0, 0, 0, 0);
    return new Date(fallback.getTime() - 1);
  }
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  return new Date(minDate.getTime() - 1);
}

interface SyncResult {
  asOfDate: Date;
  cash: number;
  ar: number;
  ap: number;
}

export async function syncOpeningBalances(opts: { asOfDate?: Date } = {}): Promise<SyncResult> {
  const asOfDate = opts.asOfDate || (await computeAsOfDate());

  // Удаляем старые opening — пересоздаём с нуля
  await prisma.openingBalance.deleteMany({});

  // Карты для резолва имён
  const [kassas, banks, kontragents] = await Promise.all([
    prisma.kassa.findMany({ select: { id: true, name: true } }),
    prisma.bankAccount.findMany({ select: { id: true, name: true } }),
    prisma.kontragent.findMany({ select: { id: true, name: true } }),
  ]);
  const kassaMap = new Map(kassas.map((x) => [x.id, x.name]));
  const bankMap = new Map(banks.map((x) => [x.id, x.name]));
  const kontMap = new Map(kontragents.map((x) => [x.id, x.name]));

  // 1) CASH
  const cashRows = await fetchBalance<CashRow>('AccumulationRegister_ДенежныеСредства', asOfDate);
  const cashByRef = new Map<string, { name: string; type: 'kassa' | 'bank'; amount: number }>();
  for (const r of cashRows) {
    if (!r.БанковскийСчетКасса) continue;
    const isBank = r.БанковскийСчетКасса_Type?.includes('БанковскиеСчета') ?? r.ТипДенежныхСредств === 'Безналичные';
    const id = r.БанковскийСчетКасса;
    const name = (isBank ? bankMap.get(id) : kassaMap.get(id)) || `[${id.slice(0, 8)}]`;
    const amount = Number(r.СуммаBalance || 0);
    const existing = cashByRef.get(id);
    if (existing) existing.amount += amount;
    else cashByRef.set(id, { name, type: isBank ? 'bank' : 'kassa', amount });
  }
  let cashTotal = 0;
  for (const [refId, v] of cashByRef.entries()) {
    cashTotal += v.amount;
    await prisma.openingBalance.create({
      data: {
        asOfDate, kind: 'cash', refId, refName: v.name, refType: v.type,
        amount: v.amount,
      },
    });
  }

  // 2) Дебиторка (РасчетыСПокупателями) — Долг = + (нам должны), Аванс = − (мы получили предоплату)
  const arRows = await fetchBalance<SettlementRow>('AccumulationRegister_РасчетыСПокупателями', asOfDate);
  const arByKont = new Map<string, number>();
  for (const r of arRows) {
    const id = r.Контрагент_Key;
    if (!id || /^0+-/.test(id)) continue;
    const sum = Number(r.СуммаBalance || 0);
    const sign = r.ТипРасчетов === 'Аванс' ? -1 : 1;
    arByKont.set(id, (arByKont.get(id) || 0) + sign * sum);
  }
  let arTotal = 0;
  for (const [refId, amount] of arByKont.entries()) {
    if (Math.abs(amount) < 0.01) continue;
    arTotal += amount;
    await prisma.openingBalance.create({
      data: {
        asOfDate, kind: 'ar', refId, refName: kontMap.get(refId) || `[${refId.slice(0, 8)}]`,
        amount,
      },
    });
  }

  // 3) Кредиторка (РасчетыСПоставщиками) — Долг = + (мы должны), Аванс = − (мы оплатили вперёд)
  const apRows = await fetchBalance<SettlementRow>('AccumulationRegister_РасчетыСПоставщиками', asOfDate);
  const apByKont = new Map<string, number>();
  for (const r of apRows) {
    const id = r.Контрагент_Key;
    if (!id || /^0+-/.test(id)) continue;
    const sum = Number(r.СуммаBalance || 0);
    const sign = r.ТипРасчетов === 'Аванс' ? -1 : 1;
    apByKont.set(id, (apByKont.get(id) || 0) + sign * sum);
  }
  let apTotal = 0;
  for (const [refId, amount] of apByKont.entries()) {
    if (Math.abs(amount) < 0.01) continue;
    apTotal += amount;
    await prisma.openingBalance.create({
      data: {
        asOfDate, kind: 'ap', refId, refName: kontMap.get(refId) || `[${refId.slice(0, 8)}]`,
        amount,
      },
    });
  }

  return { asOfDate, cash: cashTotal, ar: arTotal, ap: apTotal };
}

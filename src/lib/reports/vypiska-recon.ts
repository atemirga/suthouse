// Сверка выписки по расчётному счёту Kaspi с оплатами в 1С — по дням.
//
// Идея: Kaspi зачисляет на расчётный счёт дневные итоги «Продажи с Kaspi.kz за DD/MM»
// (с лагом ~1 день). В 1С эти же поступления лежат по-клиентно на счёте «Kaspi PAY (KZT)».
// Сверяем по БИЗНЕС-ДАТЕ («за DD/MM» из назначения), а не по дате операции.
//
// Подтверждено на реальной выписке (май'26): 21/25 дней сходятся до тенге; расхождения —
// это и есть то, что отчёт показывает (напр. 30.05 Δ=-6 800; возвраты вычитаются из продаж дня).
//
// Парсинг Excel: Kaspi отдаёт US-формат чисел («1,729,875.00»), поэтому читаем СЫРЫЕ
// числовые ячейки (raw:true) — иначе суммы парсятся неверно.

import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';

/** Счёт в 1С, на который ложатся Kaspi-оплаты клиентов (источник истины 1С-стороны). */
export const KASPI_ACCOUNT_NAME = 'Kaspi PAY (KZT)';

/** Допуск на округление, тенге. Меньше — считаем «в ноль». */
const TOLERANCE = 0.5;

export type DayStatus = 'ok' | 'diff' | 'not_in_1c' | 'not_settled' | 'missing_in_statement';

export interface OneCDoc {
  amount: number;
  who: string;
  number: string;
}

export interface DayRow {
  date: string; // YYYY-MM-DD (бизнес-дата)
  statementSales: number; // продажи − возвраты из выписки
  oneCSum: number; // Σ оплат Kaspi в 1С за день
  diff: number; // statementSales − oneCSum
  status: DayStatus;
  docs: OneCDoc[]; // 1С-документы дня (для drill-down)
}

export interface ReconResult {
  ok: true;
  account: { number: string | null; holder: string | null; period: string | null };
  balances: { opening: number | null; closing: number | null };
  days: DayRow[];
  summary: {
    totalStatement: number;
    total1c: number;
    totalDiff: number;
    daysOk: number;
    daysDiff: number;
    daysNotSettled: number;
    daysMissing: number; // нет в выписке, хотя 1С внутри периода / нет в 1С
  };
  info: {
    fees: number; // комиссия процессинга (дебет)
    withdrawals: number; // перевод собственных средств (дебет)
    accountFees: number; // абонплата за ведение счёта (дебет)
    refunds: number; // возврат продаж (вычтен из продаж дня)
    commissionRefunds: number; // возврат оплаты за процессинг (кредит)
    other: { purpose: string; debit: number; credit: number }[];
  };
  meta: { fileName: string; statementRows: number };
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Число из ячейки: уже число — берём как есть; строка — чистим US/RU-формат. */
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s || s === '-') return 0;
  const neg = s.startsWith('(') && s.endsWith(')');
  s = s.replace(/[()\s ]/g, '');
  // Если есть и запятая и точка — запятая=тысячи (US): убираем запятые.
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  // Только запятая — трактуем как десятичный разделитель (RU).
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

/** Календарный день в Asia/Almaty (UTC+5) → 'YYYY-MM-DD'. */
function almatyDay(d: Date): string {
  return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** «за DD/MM/YYYY» (или DD.MM.YYYY) из назначения → 'YYYY-MM-DD'. */
function bizDateFromPurpose(purpose: string): string | null {
  const m = purpose.match(/за\s+(\d{1,2})[./](\d{1,2})[./](\d{2,4})/i);
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function ymdAddDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── парсинг выписки ─────────────────────────────────────────────────────────────

interface ParsedStatement {
  account: { number: string | null; holder: string | null; period: string | null };
  balances: { opening: number | null; closing: number | null };
  salesByDay: Map<string, number>; // продажи − возвраты по бизнес-дате
  info: ReconResult['info'];
  bizDays: string[];
  rowCount: number;
}

export function parseKaspiStatement(buf: Buffer): ParsedStatement {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

  const cellAfter = (label: string): string | null => {
    for (const r of rows) {
      const c0 = String(r[0] ?? '').trim().toLowerCase();
      if (c0.includes(label)) {
        for (let j = 1; j < r.length; j++) {
          const v = String(r[j] ?? '').trim();
          if (v) return v;
        }
      }
    }
    return null;
  };
  const numAfter = (label: string): number | null => {
    const v = cellAfter(label);
    return v === null ? null : toNum(v);
  };

  const account = {
    number: cellAfter('текущий счет') || cellAfter('лицевой счет'),
    holder: cellAfter('наименование'),
    period: cellAfter('период'),
  };
  const balances = {
    opening: numAfter('входящий остаток'),
    closing: numAfter('исходящий остаток'),
  };

  // Строка заголовков таблицы (есть «дебет» и «кредит»).
  let hdr = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = rows[i].map((c) => String(c ?? '').toLowerCase()).join('|');
    if (joined.includes('дебет') && joined.includes('кредит')) { hdr = i; break; }
  }
  if (hdr < 0) throw new Error('Не найдена таблица операций (нет колонок «Дебет/Кредит»). Это точно выписка Kaspi по счёту?');
  const headers = rows[hdr].map((c) => String(c ?? '').toLowerCase());
  const findCol = (kw: string) => headers.findIndex((h) => h.includes(kw));
  const ci = {
    date: findCol('дата'),
    debit: findCol('дебет'),
    credit: findCol('кредит'),
    knp: findCol('кнп'),
    purpose: findCol('назначение'),
  };
  if (ci.credit < 0 || ci.purpose < 0) throw new Error('В выписке нет колонок «Кредит»/«Назначение платежа».');

  const salesByDay = new Map<string, number>();
  const info: ReconResult['info'] = {
    fees: 0, withdrawals: 0, accountFees: 0, refunds: 0, commissionRefunds: 0, other: [],
  };
  let rowCount = 0;

  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    const opDate = String(r[ci.date] ?? '').trim();
    // Строка данных обязана иметь дату вида DD.MM.YYYY — так отсекаем под-шапку «1 2 3…».
    if (!/\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(opDate)) continue;
    const debit = toNum(r[ci.debit]);
    const credit = toNum(r[ci.credit]);
    const purpose = String(r[ci.purpose] ?? '').trim();
    if (!debit && !credit) continue;
    rowCount++;
    const p = purpose.toLowerCase();
    const biz = bizDateFromPurpose(purpose) || (() => {
      // запасной вариант: бизнес-дата = дата операции
      const m = opDate.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
      if (!m) return null;
      const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    })();

    if (p.includes('продажи с kaspi')) {
      if (biz) saleAdd(salesByDay, biz, credit);
    } else if (p.includes('возврат продаж')) {
      // возврат уменьшает продажи дня (в выписке записан как дебет)
      const amt = debit || credit;
      if (biz) saleAdd(salesByDay, biz, -amt);
      info.refunds += amt;
    } else if (p.includes('процессинг') || p.includes('услуги')) {
      if (p.includes('возврат')) info.commissionRefunds += credit || debit;
      else info.fees += debit || credit;
    } else if (p.includes('перевод собственных')) {
      info.withdrawals += debit || credit;
    } else if (p.includes('ведение счет')) {
      info.accountFees += debit || credit;
    } else {
      info.other.push({ purpose, debit, credit });
    }
  }

  const bizDays = Array.from(salesByDay.keys()).sort();
  return { account, balances, salesByDay, info, bizDays, rowCount };
}

function saleAdd(map: Map<string, number>, day: string, amt: number) {
  map.set(day, (map.get(day) || 0) + amt);
}

// ── 1С-сторона ──────────────────────────────────────────────────────────────────

async function loadOneCByDay(from: Date, to: Date): Promise<Map<string, { sum: number; docs: OneCDoc[] }>> {
  const docs = await prisma.ddsDocument.findMany({
    where: {
      direction: 'inflow',
      accountName: KASPI_ACCOUNT_NAME,
      date: { gte: from, lte: to },
    },
    select: { date: true, amount: true, kontragentName: true, number: true },
    orderBy: { date: 'asc' },
  });
  const byDay = new Map<string, { sum: number; docs: OneCDoc[] }>();
  for (const d of docs) {
    const day = almatyDay(d.date);
    const e = byDay.get(day) || { sum: 0, docs: [] };
    e.sum += d.amount;
    e.docs.push({ amount: d.amount, who: d.kontragentName ?? '—', number: d.number });
    byDay.set(day, e);
  }
  return byDay;
}

// ── главная функция ──────────────────────────────────────────────────────────────

export async function reconcileVypiska(buf: Buffer, fileName: string): Promise<ReconResult> {
  const st = parseKaspiStatement(buf);
  if (!st.bizDays.length) {
    throw new Error('В выписке не найдено ни одной строки «Продажи с Kaspi.kz». Проверьте файл.');
  }
  const minBiz = st.bizDays[0];
  const maxBiz = st.bizDays[st.bizDays.length - 1];

  // 1С грузим от первого дня продаж до дня ПОСЛЕ последнего — чтобы поймать
  // граничные платежи, которые ещё не засеттлены (статус not_settled).
  const from = new Date(minBiz + 'T00:00:00+05:00');
  const to = new Date(ymdAddDays(maxBiz, 1) + 'T23:59:59.999+05:00');
  const oneC = await loadOneCByDay(from, to);

  const allDays = Array.from(new Set([...st.salesByDay.keys(), ...oneC.keys()])).sort();
  const days: DayRow[] = [];
  let totalStatement = 0, total1c = 0, daysOk = 0, daysDiff = 0, daysNotSettled = 0, daysMissing = 0;

  for (const day of allDays) {
    const statementSales = round2(st.salesByDay.get(day) || 0);
    const oc = oneC.get(day);
    const oneCSum = round2(oc?.sum || 0);
    const diff = round2(statementSales - oneCSum);
    totalStatement += statementSales;
    total1c += oneCSum;

    let status: DayStatus;
    if (statementSales > TOLERANCE && oneCSum > TOLERANCE) {
      status = Math.abs(diff) <= TOLERANCE ? 'ok' : 'diff';
    } else if (statementSales > TOLERANCE) {
      status = 'not_in_1c'; // банк зачислил, а в 1С нет
    } else {
      // только 1С: если это день после последнего дня выписки — ещё не засеттлено
      status = day > maxBiz ? 'not_settled' : 'missing_in_statement';
    }
    if (status === 'ok') daysOk++;
    else if (status === 'diff') daysDiff++;
    else if (status === 'not_settled') daysNotSettled++;
    else daysMissing++;

    days.push({ date: day, statementSales, oneCSum, diff, status, docs: oc?.docs ?? [] });
  }

  return {
    ok: true,
    account: st.account,
    balances: st.balances,
    days,
    summary: {
      totalStatement: round2(totalStatement),
      total1c: round2(total1c),
      totalDiff: round2(totalStatement - total1c),
      daysOk, daysDiff, daysNotSettled, daysMissing,
    },
    info: st.info,
    meta: { fileName, statementRows: st.rowCount },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

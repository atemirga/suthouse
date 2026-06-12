// Универсальная сверка банковской выписки с поступлениями в 1С — по дням.
//
// Принимает ЛЮБУЮ выписку (Excel/CSV или PDF), сам определяет формат и поступления:
//   • Kaspi Pay (расч. счёт)   — колонки Дебет/Кредит/Назначение, «Продажи с Kaspi.kz за D»
//   • Kaspi Gold (карта)       — Дата/Сумма(±)/Операция/Детали, поступление = «Пополнение»
//   • Halyk POS (эквайринг)    — Тип операции «Оплата», Сумма операции / к зачислению
//   • generic                  — по заголовкам (дата + дебет/кредит | сумма + операция)
// Поступления суммируются по дню и сверяются с входящими ДДС 1С по выбранному счёту.
//
// Excel парсится SheetJS (сырые числа), PDF — через `pdftotext -layout` (poppler).

import * as XLSX from 'xlsx';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@/lib/db';

const TOLERANCE = 0.5;

export type StatementFormat = 'kaspi-pay' | 'kaspi-gold' | 'halyk-pos' | 'generic';
export type DayStatus = 'ok' | 'diff' | 'not_in_1c' | 'not_settled' | 'missing_in_statement';

export interface Txn {
  date: string;        // YYYY-MM-DD (эффективная дата для сверки)
  amount: number;      // положительная сумма поступления
  who: string;         // плательщик/детали
  op: string;          // тип операции
}
export interface OneCDoc { amount: number; who: string; number: string }
export interface DayRow {
  date: string; statementSales: number; oneCSum: number; diff: number;
  status: DayStatus; docs: OneCDoc[];
}
export interface ReconResult {
  ok: true;
  format: StatementFormat;
  detectedBank: string;
  account: string;                 // счёт 1С, по которому сверяли
  accountOptions: string[];        // все счета 1С для выбора в UI
  meta: { fileName: string; holder: string | null; period: string | null; opening: number | null; closing: number | null; rows: number };
  days: DayRow[];
  summary: { totalStatement: number; total1c: number; totalDiff: number; daysOk: number; daysDiff: number; daysNotSettled: number; daysMissing: number };
  info: { incomingCount: number; outgoing: number; outgoingCount: number };
}

// ── утилиты ──────────────────────────────────────────────────────────────────
function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/₸|тенге|тг|kzt/gi, '').trim();
  if (!s || s === '-') return 0;
  const neg = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/[()+]/g, '').replace(/\s/g, '').replace(/^-/, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');   // US: 1,729,875.00
  else if (s.includes(',')) s = s.replace(',', '.');                  // RU: 1 729,00
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}
function almatyDay(d: Date): string { return new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10); }
function ymdAdd(ymd: string, n: number): string { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// «DD.MM.YYYY» / «DD.MM.YY» / «DD/MM/YYYY» → YYYY-MM-DD
function parseDmy(s: string): string | null {
  const m = String(s).trim().match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
function bizDate(purpose: string): string | null {
  const m = purpose.match(/за\s+(\d{1,2})[./](\d{1,2})[./](\d{2,4})/i);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const INCOMING_OPS = /пополнен|оплата|поступлен|зачислен|приход|продаж/i;
const OUTGOING_OPS = /возврат|перевод|снятие|покупк|комисси|списан|расход|выдач|погашен|абонент/i;

// ── чтение файла → grid + text ───────────────────────────────────────────────
function readExcel(buf: Buffer): { grid: any[][]; text: string } {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const text = grid.map((r) => r.join(' ')).join('\n');
  return { grid, text };
}
function readPdf(buf: Buffer): { lines: string[]; text: string } {
  const tmp = join(tmpdir(), `stmt-${process.pid}-${buf.length}.pdf`);
  writeFileSync(tmp, buf);
  try {
    const out = execFileSync('pdftotext', ['-layout', tmp, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    return { lines: out.split('\n'), text: out };
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function detectFormat(text: string): StatementFormat {
  const t = text.toLowerCase();
  if (/pos-договор|сумма к зачислению|тип операции/.test(t)) return 'halyk-pos';
  if (/kaspi gold|операция/.test(t) && /детали/.test(t)) return 'kaspi-gold';
  if (/продажи с kaspi|назначение платежа/.test(t) && /дебет/.test(t)) return 'kaspi-pay';
  return 'generic';
}
// Банк/счёт-подсказку определяем по ФОРМАТУ (надёжнее, чем по тексту транзакций —
// в назначениях Kaspi Pay встречается «на карту Kaspi Gold» и сбивает детект).
function bankAndAccount(format: StatementFormat): { bank: string; hint: string } {
  switch (format) {
    case 'halyk-pos': return { bank: 'Halyk POS', hint: 'Halyk POS (KZT)' };
    case 'kaspi-gold': return { bank: 'Kaspi Gold', hint: 'Kaspi GOLD (KZT)' };
    case 'kaspi-pay': return { bank: 'Kaspi Pay', hint: 'Kaspi PAY (KZT)' };
    default: return { bank: 'неизвестно', hint: '' };
  }
}

// ── извлечение транзакций по форматам ────────────────────────────────────────
interface Extracted { incoming: Txn[]; outgoing: Txn[]; opening: number | null; closing: number | null; period: string | null; holder: string | null; rows: number }

function extractKaspiPay(grid: any[][]): Extracted {
  const cellAfter = (label: string) => {
    for (const r of grid) if (String(r[0] ?? '').toLowerCase().includes(label)) for (let j = 1; j < r.length; j++) { const v = String(r[j] ?? '').trim(); if (v) return v; }
    return null;
  };
  let hdr = grid.findIndex((r) => { const j = r.map((c) => String(c ?? '').toLowerCase()).join('|'); return j.includes('дебет') && j.includes('кредит'); });
  const headers = (grid[hdr] || []).map((c) => String(c ?? '').toLowerCase());
  const ci = { date: headers.findIndex((h) => h.includes('дата')), debit: headers.findIndex((h) => h.includes('дебет')), credit: headers.findIndex((h) => h.includes('кредит')), purpose: headers.findIndex((h) => h.includes('назначение')) };
  // Поступления = «Продажи с Kaspi.kz за D» по бизнес-дате, МИНУС «Возврат продаж за D».
  // Остальные кредиты/дебеты (комиссия процессинга, вывод) — в outgoing справочно.
  const salesByDay = new Map<string, number>();
  const outgoing: Txn[] = [];
  for (let i = hdr + 1; i < grid.length; i++) {
    const r = grid[i]; const opDate = String(r[ci.date] ?? '').trim();
    if (!/\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(opDate)) continue;
    const credit = toNum(r[ci.credit]), debit = toNum(r[ci.debit]); const purpose = String(r[ci.purpose] ?? '').trim();
    if (!credit && !debit) continue;
    const p = purpose.toLowerCase(); const day = bizDate(purpose) || parseDmy(opDate); if (!day) continue;
    if (p.includes('продажи с kaspi')) salesByDay.set(day, (salesByDay.get(day) || 0) + credit);
    else if (p.includes('возврат продаж')) salesByDay.set(day, (salesByDay.get(day) || 0) - (debit || credit));
    else if (debit > 0) outgoing.push({ date: day, amount: debit, who: purpose.slice(0, 50), op: 'Дебет' });
  }
  const incoming: Txn[] = [...salesByDay.entries()].filter(([, v]) => v > 0.5).map(([day, v]) => ({ date: day, amount: v, who: 'Продажи с Kaspi.kz', op: 'Кредит' }));
  return { incoming, outgoing, opening: toNum(cellAfter('входящий остаток')) || null, closing: toNum(cellAfter('исходящий остаток')) || null, period: cellAfter('период'), holder: cellAfter('наименование'), rows: incoming.length + outgoing.length };
}

// Kaspi Gold из строк pdftotext (Дата  Сумма  Операция  Детали)
function extractKaspiGold(lines: string[], text: string): Extracted {
  const incoming: Txn[] = [], outgoing: Txn[] = [];
  for (const ln of lines) {
    const m = ln.match(/^\s*(\d{2}\.\d{2}\.\d{2,4})\s+([+\-]?\s?[\d  ]+,\d{2})\s*₸?\s+(\S+)\s+(.+?)\s*$/);
    if (!m) continue;
    const day = parseDmy(m[1]); if (!day) continue;
    const amt = toNum(m[2]); const op = m[3].trim(); const who = m[4].trim();
    if (amt > 0 && INCOMING_OPS.test(op)) incoming.push({ date: day, amount: amt, who, op });
    else outgoing.push({ date: day, amount: Math.abs(amt), who, op });
  }
  const holder = (text.match(/ВЫПИСКА[\s\S]{0,80}?\n\s*([A-ZА-Я][^\n]+)/) || [])[1]?.trim() || null;
  const period = (text.match(/за период с ([\d.]+ по [\d.]+)/i) || [])[1] || null;
  const closing = toNum((text.match(/Доступно на [\d.]+\s+([+\-][\d  ]+,\d{2})\s*₸/g) || []).slice(-1)[0] || '') || null;
  return { incoming, outgoing, opening: null, closing, period, holder, rows: incoming.length + outgoing.length };
}

// Halyk POS из строк pdftotext (многострочные записи; берём строку с типом операции и 3 числами)
function extractHalykPos(lines: string[], text: string): Extracted {
  const incoming: Txn[] = [], outgoing: Txn[] = [];
  for (const ln of lines) {
    // дата зачисления ... ТипОперации СуммаОперации СуммаКЗачислению Комиссия
    // (без \b — он ASCII-only и не срабатывает на кириллице)
    const m = ln.match(/^\s*(\d{2}\.\d{2}\.\d{4}).*?\s(Оплата бонусами|Оплата|Возврат|Комиссия[^\d]*?)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s+(-?[\d.,]+)/);
    if (!m) continue;
    const day = parseDmy(m[1]); if (!day) continue;
    const op = m[2].trim(); const gross = toNum(m[3]);
    if (op === 'Оплата' && gross > 0) incoming.push({ date: day, amount: gross, who: 'POS', op: 'Оплата' });
    else outgoing.push({ date: day, amount: Math.abs(gross), who: 'POS', op });
  }
  const period = (text.match(/за период\s+с\s+([\d.]+)\s+по\s+([\d.]+)/i) || []).slice(1).join(' — ') || null;
  return { incoming, outgoing, opening: null, closing: null, period, holder: 'POS-договор', rows: incoming.length + outgoing.length };
}

// Универсальный разбор табличной сетки (Excel любого банка) по заголовкам
function extractGeneric(grid: any[][]): Extracted {
  let hdr = -1, best = 0;
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const j = grid[i].map((c) => String(c ?? '').toLowerCase()).join('|');
    let score = 0; for (const kw of ['дата', 'сумма', 'операци', 'детали', 'дебет', 'кредит', 'назначени', 'зачислен']) if (j.includes(kw)) score++;
    if (score > best) { best = score; hdr = i; }
  }
  if (hdr < 0) return { incoming: [], outgoing: [], opening: null, closing: null, period: null, holder: null, rows: 0 };
  const headers = grid[hdr].map((c) => String(c ?? '').toLowerCase());
  const find = (...kw: string[]) => headers.findIndex((h) => kw.some((k) => h.includes(k)));
  const ci = { date: find('дата'), debit: find('дебет'), credit: find('кредит'), amount: find('сумма операци', 'сумма'), op: find('тип операц', 'операци'), who: find('детал', 'назначени', 'наименование', 'бенефициар') };
  const incoming: Txn[] = [], outgoing: Txn[] = [];
  for (let i = hdr + 1; i < grid.length; i++) {
    const r = grid[i]; const ds = String(r[ci.date] ?? '').trim(); const day = parseDmy(ds); if (!day) continue;
    const who = (ci.who >= 0 ? String(r[ci.who] ?? '') : '').trim().slice(0, 60);
    const op = ci.op >= 0 ? String(r[ci.op] ?? '').trim() : '';
    if (ci.credit >= 0 && ci.debit >= 0) {
      const c = toNum(r[ci.credit]), d = toNum(r[ci.debit]);
      if (c > 0) incoming.push({ date: day, amount: c, who, op: op || 'Кредит' });
      else if (d > 0) outgoing.push({ date: day, amount: d, who, op: op || 'Дебет' });
    } else if (ci.amount >= 0) {
      const a = toNum(r[ci.amount]); if (!a) continue;
      const out = OUTGOING_OPS.test(op) || (a < 0 && !INCOMING_OPS.test(op));
      if (out) outgoing.push({ date: day, amount: Math.abs(a), who, op });
      else incoming.push({ date: day, amount: Math.abs(a), who, op });
    }
  }
  return { incoming, outgoing, opening: null, closing: null, period: null, holder: null, rows: incoming.length + outgoing.length };
}

export function parseStatement(buf: Buffer, fileName: string): { format: StatementFormat; bank: string; hint: string; ext: Extracted; text: string } {
  const isPdf = /\.pdf$/i.test(fileName) || buf.slice(0, 4).toString() === '%PDF';
  let grid: any[][] = [], lines: string[] = [], text = '';
  if (isPdf) { const r = readPdf(buf); lines = r.lines; text = r.text; grid = lines.map((l) => l.split(/\s{2,}/).map((s) => s.trim())); }
  else { const r = readExcel(buf); grid = r.grid; text = r.text; lines = text.split('\n'); }

  const format = detectFormat(text);
  const { bank, hint } = bankAndAccount(format);
  let ext: Extracted;
  if (format === 'kaspi-pay') ext = extractKaspiPay(grid);
  else if (format === 'kaspi-gold') ext = isPdf ? extractKaspiGold(lines, text) : extractGeneric(grid);
  else if (format === 'halyk-pos') ext = isPdf ? extractHalykPos(lines, text) : extractGeneric(grid);
  else ext = extractGeneric(grid);
  return { format, bank, hint, ext, text };
}

// ── 1С-сторона ───────────────────────────────────────────────────────────────
async function loadOneCByDay(accountName: string, from: Date, to: Date) {
  const docs = await prisma.ddsDocument.findMany({
    where: { direction: 'inflow', accountName, date: { gte: from, lte: to } },
    select: { date: true, amount: true, kontragentName: true, number: true }, orderBy: { date: 'asc' },
  });
  const byDay = new Map<string, { sum: number; docs: OneCDoc[] }>();
  for (const d of docs) { const day = almatyDay(d.date); const e = byDay.get(day) || { sum: 0, docs: [] }; e.sum += d.amount; e.docs.push({ amount: d.amount, who: d.kontragentName ?? '—', number: d.number }); byDay.set(day, e); }
  return byDay;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── главная функция ──────────────────────────────────────────────────────────
export async function reconcileVypiska(buf: Buffer, fileName: string, accountOverride?: string): Promise<ReconResult> {
  const parsed = parseStatement(buf, fileName);
  const incoming = parsed.ext.incoming;
  if (!incoming.length) throw new Error('Не удалось распознать поступления в выписке. Проверьте файл/формат.');

  const accounts = await prisma.bankAccount.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  const accountOptions = accounts.map((a) => a.name);
  // выбранный счёт: override → подсказка по банку → есть ли такой счёт
  let account = accountOverride || parsed.hint;
  if (!account || !accountOptions.includes(account)) account = accountOptions.includes(parsed.hint) ? parsed.hint : (accountOptions[0] || '');

  // поступления по дню
  const salesByDay = new Map<string, number>();
  for (const t of incoming) salesByDay.set(t.date, (salesByDay.get(t.date) || 0) + t.amount);
  const days = Array.from(salesByDay.keys()).sort();
  const minBiz = days[0], maxBiz = days[days.length - 1];

  const from = new Date(minBiz + 'T00:00:00+05:00');
  const to = new Date(ymdAdd(maxBiz, 1) + 'T23:59:59.999+05:00');
  const oneC = await loadOneCByDay(account, from, to);

  const allDays = Array.from(new Set([...salesByDay.keys(), ...oneC.keys()])).sort();
  const rows: DayRow[] = [];
  let totalStatement = 0, total1c = 0, daysOk = 0, daysDiff = 0, daysNotSettled = 0, daysMissing = 0;
  for (const day of allDays) {
    const statementSales = round2(salesByDay.get(day) || 0);
    const oc = oneC.get(day); const oneCSum = round2(oc?.sum || 0);
    const diff = round2(statementSales - oneCSum);
    totalStatement += statementSales; total1c += oneCSum;
    let status: DayStatus;
    if (statementSales > TOLERANCE && oneCSum > TOLERANCE) status = Math.abs(diff) <= TOLERANCE ? 'ok' : 'diff';
    else if (statementSales > TOLERANCE) status = 'not_in_1c';
    else status = day > maxBiz ? 'not_settled' : 'missing_in_statement';
    if (status === 'ok') daysOk++; else if (status === 'diff') daysDiff++; else if (status === 'not_settled') daysNotSettled++; else daysMissing++;
    rows.push({ date: day, statementSales, oneCSum, diff, status, docs: oc?.docs ?? [] });
  }

  const outgoing = parsed.ext.outgoing.reduce((s, t) => s + t.amount, 0);
  return {
    ok: true,
    format: parsed.format,
    detectedBank: parsed.bank,
    account,
    accountOptions,
    meta: { fileName, holder: parsed.ext.holder, period: parsed.ext.period, opening: parsed.ext.opening, closing: parsed.ext.closing, rows: parsed.ext.rows },
    days: rows,
    summary: { totalStatement: round2(totalStatement), total1c: round2(total1c), totalDiff: round2(totalStatement - total1c), daysOk, daysDiff, daysNotSettled, daysMissing },
    info: { incomingCount: incoming.length, outgoing: round2(outgoing), outgoingCount: parsed.ext.outgoing.length },
  };
}

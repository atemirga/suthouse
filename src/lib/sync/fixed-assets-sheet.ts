// Чтение реестра основных средств из Google-таблицы финансиста.
// Источник истины: «Ведомость по ОС_Sut House», лист «Ведомость».
//
// Структура листа:
//   Row4: шапка
//   Rows 5..N: объекты ОС
//   Колонки:
//     A — Тип ОС (Оргтехника / Мебель / Инструменты / Транспорт / …)
//     B — Местонахождение
//     C — Наименование
//     E — Инв №
//     F — СПИ, мес
//     G — Первоначальная стоимость
//     J — Дата покупки
//     K — Дата ввода в эксплуатацию
//     M — Ответственный
//     N — Дата списания
//     S — Остаточная стоимость на начало реестра (01.10.2025)
//     V..AK — Амортизация по месяцам окт.25 … янв.27 (значения в скобках = отрицательные)
//     AN..BC — Остаточная стоимость по месяцам окт.25 … янв.27
//
// Для баланса на дату asOf берём столбец остаточной стоимости месяца asOf.
// Если объект списан (Дата списания ≤ asOf) или столбца ещё не существует —
// NBV = 0. Сумма по всем строкам = «Техника, мебель» в балансе.

import { google } from 'googleapis';

export interface FixedAssetSheetRow {
  rowIndex: number;       // строка в листе (для отладки)
  type: string;           // Оргтехника / Мебель / …
  location: string;
  name: string;
  invNum: string;
  cost: number;           // первоначальная стоимость, ₸
  usefulMonths: number;
  purchaseDate: string | null;  // YYYY-MM-DD
  startDate: string | null;
  responsible: string;
  disposalDate: string | null;  // YYYY-MM-DD если списано
  openingResidual: number;
  netBookValue: number;         // остаточная стоимость на asOf, ₸
  accumulatedDepreciation: number;  // = cost − NBV
  asOfMonth: string;            // YYYY-MM, столбец который взяли
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: FixedAssetSheetRow[] }>();

// AN..BC: 16 столбцов, мес. 2025-10 … 2027-01.
// V..AK: 16 столбцов амортизации в той же раскладке.
const RESIDUAL_MONTHS: { col: number; ym: string }[] = [
  { col: 39, ym: '2025-10' }, // AN
  { col: 40, ym: '2025-11' }, // AO
  { col: 41, ym: '2025-12' }, // AP
  { col: 42, ym: '2026-01' }, // AQ
  { col: 43, ym: '2026-02' }, // AR
  { col: 44, ym: '2026-03' }, // AS
  { col: 45, ym: '2026-04' }, // AT
  { col: 46, ym: '2026-05' }, // AU
  { col: 47, ym: '2026-06' }, // AV
  { col: 48, ym: '2026-07' }, // AW
  { col: 49, ym: '2026-08' }, // AX
  { col: 50, ym: '2026-09' }, // AY
  { col: 51, ym: '2026-10' }, // AZ
  { col: 52, ym: '2026-11' }, // BA
  { col: 53, ym: '2026-12' }, // BB
  { col: 54, ym: '2027-01' }, // BC
];

const COL = {
  TYPE: 0,        // A
  LOCATION: 1,    // B
  NAME: 2,        // C
  INV: 4,         // E
  USEFUL: 5,      // F
  COST: 6,        // G
  PURCHASE: 9,    // J
  START: 10,      // K
  RESPONSIBLE: 12, // M
  DISPOSAL: 13,   // N
  OPENING_RESIDUAL: 18, // S
};

export async function loadFixedAssetsFromSheet(asOf: Date): Promise<FixedAssetSheetRow[]> {
  const ym = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}`;
  const cacheKey = ym;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const sheetId = process.env.AMORTIZATION_SHEET_ID;
  if (!keyPath || !sheetId) return [];

  // Выбираем столбец остаточной стоимости: точное совпадение по YM, либо
  // ближайший меньший (если asOf > последнего месяца — берём последний).
  let pickedIdx = -1;
  for (let i = 0; i < RESIDUAL_MONTHS.length; i++) {
    if (RESIDUAL_MONTHS[i].ym <= ym) pickedIdx = i;
  }
  if (pickedIdx === -1) pickedIdx = 0; // asOf раньше начала ведения — берём первый
  const picked = RESIDUAL_MONTHS[pickedIdx];

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Ведомость!A5:CM250',
  });
  const rows = res.data.values || [];

  const out: FixedAssetSheetRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const name = String(r[COL.NAME] ?? '').trim();
    if (!name) continue;
    const cost = parseNum(r[COL.COST]);
    if (cost <= 0) continue;

    const disposal = parseDate(r[COL.DISPOSAL]);
    const asOfDateStr = asOf.toISOString().slice(0, 10);
    const isDisposed = disposal !== null && disposal <= asOfDateStr;

    const residualRaw = r[picked.col];
    const nbv = isDisposed ? 0 : parseNum(residualRaw);

    out.push({
      rowIndex: i + 5,
      type: String(r[COL.TYPE] ?? '').trim() || '—',
      location: String(r[COL.LOCATION] ?? '').trim() || '—',
      name,
      invNum: String(r[COL.INV] ?? '').trim(),
      cost,
      usefulMonths: parseNum(r[COL.USEFUL]) || 60,
      purchaseDate: parseDate(r[COL.PURCHASE]),
      startDate: parseDate(r[COL.START]),
      responsible: String(r[COL.RESPONSIBLE] ?? '').trim(),
      disposalDate: disposal,
      openingResidual: parseNum(r[COL.OPENING_RESIDUAL]),
      netBookValue: nbv,
      accumulatedDepreciation: Math.max(0, cost - nbv),
      asOfMonth: picked.ym,
    });
  }

  cache.set(cacheKey, { at: Date.now(), data: out });
  return out;
}

// Парсер чисел из формата «(429 597)» (отрицательное), «350 000,00», «157 500».
// Прочерки/пустые → 0.
function parseNum(v: any): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s || s === '-') return 0;
  const neg = s.startsWith('(') && s.endsWith(')');
  const stripped = s.replace(/[()\s ]/g, '').replace(',', '.');
  if (!stripped) return 0;
  const n = parseFloat(stripped);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

// Парсер даты: «01.02.2025» или «1/10/2025». Возвращает YYYY-MM-DD или null.
function parseDate(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === '-') return null;
  // dd.mm.yyyy
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }
  // yyyy-mm-dd (на всякий)
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    return `${m[1]}-${mm}-${dd}`;
  }
  return null;
}

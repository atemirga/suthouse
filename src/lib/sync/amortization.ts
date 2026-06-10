// Чтение помесячной амортизации из Google-таблицы финансиста.
// Источник истины: «Ведомость по ОС_Sut House», лист «Ведомость».
// Берём готовые итоги по колонкам в строке 3 (формат `(429 597)` = -429597),
// маппим на месяцы из шапки строки 4. Возвращаем положительные суммы расхода
// (как ожидает bucket 'amortization' в opiu.ts).
import { google } from 'googleapis';

type MonthAmount = Map<string, number>; // 'YYYY-MM' → положительная сумма

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: MonthAmount } | null = null;

export async function loadAmortizationFromSheet(): Promise<MonthAmount> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const sheetId = process.env.AMORTIZATION_SHEET_ID;
  if (!keyPath || !sheetId) return new Map();

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Ведомость!A3:CM4',
  });
  const rows = res.data.values || [];
  const totalsRow = rows[0] || [];
  const headerRow = rows[1] || [];

  const out: MonthAmount = new Map();
  for (let i = 0; i < headerRow.length; i++) {
    const ym = parseMonthHeader(String(headerRow[i] ?? ''));
    if (!ym) continue;
    // Учитываем только колонки блока «Амортизация» (V..AK). Дальше идут блоки
    // «Остаточная стоимость», «Выбытие», «Прибыль/убыток» с теми же месячными
    // заголовками — их пропускаем по индексу.
    if (i < 21 || i > 36) continue; // V=21, AK=36
    const raw = String(totalsRow[i] ?? '').trim();
    // Амортизация в таблице ВСЕГДА в скобках (отрицательное число). Голое
    // положительное значение в этой колонке — другой показатель (например
    // первоначальная стоимость), пропускаем.
    if (!raw.startsWith('(')) continue;
    const n = parseAmount(raw);
    if (n === null) continue;
    out.set(ym, Math.abs(n));
  }

  cache = { at: Date.now(), data: out };
  return out;
}

function parseMonthHeader(s: string): string | null {
  // Формат: "-окт.25", "-нояб.25", "-мая26", "-янв.27"
  const cleaned = s.replace(/^[\s-]+/, '').toLowerCase().replace(/\s+/g, '');
  const m = cleaned.match(/^([а-я]+)\.?(\d{2})$/);
  if (!m) return null;
  const monthMap: Record<string, number> = {
    'янв': 1, 'февр': 2, 'фев': 2, 'мар': 3, 'апр': 4,
    'мая': 5, 'май': 5, 'июн': 6, 'июл': 7, 'авг': 8,
    'сент': 9, 'сен': 9, 'окт': 10, 'нояб': 11, 'ноя': 11, 'дек': 12,
  };
  const mm = monthMap[m[1]];
  if (!mm) return null;
  const yy = parseInt(m[2], 10);
  const yyyy = 2000 + yy;
  return `${yyyy}-${String(mm).padStart(2, '0')}`;
}

function parseAmount(s: string): number | null {
  if (!s || s === '-') return null;
  const neg = s.startsWith('(') && s.endsWith(')');
  const stripped = s.replace(/[()\s ]/g, '').replace(',', '.');
  if (!stripped) return null;
  const n = parseFloat(stripped);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

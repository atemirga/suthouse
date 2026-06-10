// XYZ-анализ номенклатуры — стабильность спроса по коэффициенту вариации (CV).
//
// Метод: для каждого SKU считаем продажи помесячно за выбранный период,
// затем CV = stddev / mean. Классы:
//   X: CV < 10%   — стабильный спрос, легко планировать запас
//   Y: 10%-25%    — умеренные колебания
//   Z: CV >= 25%  — нестабильно / редко, держать минимальный буфер
//
// Параметр анализа:
//   * 'revenue'  — выручка (₸)
//   * 'quantity' — масса в кг (все продукты весовые)
//
// Особенности:
//   - SKU с продажами только в 1 месяце за период автоматически → Z (CV=0
//     математически, но это «один укол» — не стабильность). Помечается флагом
//     singleMonth.
//   - Месяцы без продаж учитываются как 0 — это правильно для CV, иначе
//     товар с продажами только в декабре будет «X», что вводит в заблуждение.

import { prisma } from '@/lib/db';
import { eachMonthOfInterval, format } from 'date-fns';

export type XyzParam = 'revenue' | 'quantity';
export type XyzClass = 'X' | 'Y' | 'Z';

export interface XyzRow {
  nomenclatureId: string | null;
  name: string;
  category: string | null;
  totalRevenue: number;
  totalQuantity: number;
  mean: number;          // среднее за месяц по выбранному параметру
  stddev: number;
  cv: number;            // коэффициент вариации (0..N)
  monthsWithSales: number;
  monthsInPeriod: number;
  singleMonth: boolean;  // продажа была только в одном месяце
  xyzClass: XyzClass;
  byMonth: Record<string, number>; // YYYY-MM → value
}

export interface XyzReport {
  param: XyzParam;
  from: Date;
  to: Date;
  months: string[];      // YYYY-MM колонки
  classCounts: { X: number; Y: number; Z: number };
  classTotals: {
    X: { revenue: number; quantity: number; skuCount: number };
    Y: { revenue: number; quantity: number; skuCount: number };
    Z: { revenue: number; quantity: number; skuCount: number };
  };
  totals: {
    revenue: number;
    quantity: number;
    skuCount: number;
    avgMonths: number;   // средняя ширина продаж (месяцев из периода)
  };
  rows: XyzRow[];
}

interface BuildOpts {
  from: Date;
  to: Date;
  param?: XyzParam;
  thresholdX?: number;   // default 0.10
  thresholdY?: number;   // default 0.25
}

interface MonthlyAggRow {
  nomenclatureId: string | null;
  nomenclatureName: string | null;
  ym: string;
  quantity: number;
  amount: number;
}

export async function buildXyz(opts: BuildOpts): Promise<XyzReport> {
  const param: XyzParam = opts.param || 'revenue';
  const thX = opts.thresholdX ?? 0.10;
  const thY = opts.thresholdY ?? 0.25;

  // Месяцы выбираемого периода (Asia/Almaty — как в остальных отчётах).
  const monthsInRange = eachMonthOfInterval({ start: opts.from, end: opts.to });
  const months = monthsInRange.map((d) => format(d, 'yyyy-MM'));
  const monthsCount = months.length || 1;

  // Группировка items по nomenclatureId + YYYY-MM на стороне БД.
  // TIMEZONE: 1С документы хранятся в Asia/Almaty (см. [[date-handling-1c]]).
  const grouped = await prisma.$queryRaw<MonthlyAggRow[]>`
    SELECT
      ri."nomenclatureId",
      ri."nomenclatureName",
      TO_CHAR(r.date AT TIME ZONE 'Asia/Almaty', 'YYYY-MM') AS ym,
      SUM(ri.quantity)::float AS quantity,
      SUM(ri.amount)::float AS amount
    FROM "RealizaciaItem" ri
    JOIN "Realizacia" r ON r.id = ri."realizaciaId"
    WHERE r.posted = true
      AND r.date >= ${opts.from}
      AND r.date <= ${opts.to}
    GROUP BY ri."nomenclatureId", ri."nomenclatureName", ym
  `;

  // Категории номенклатуры
  const nomIds = Array.from(new Set(grouped.map((g) => g.nomenclatureId).filter((x): x is string => !!x)));
  const noms = nomIds.length
    ? await prisma.nomenclature.findMany({
        where: { id: { in: nomIds } },
        select: { id: true, categoryId: true },
      })
    : [];
  const catIds = Array.from(new Set(noms.map((n) => n.categoryId).filter((x): x is string => !!x)));
  const cats = catIds.length
    ? await prisma.nomenclatureCategory.findMany({
        where: { id: { in: catIds } },
        select: { id: true, name: true },
      })
    : [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const nomToCat = new Map(noms.map((n) => [n.id, n.categoryId ? catName.get(n.categoryId) || null : null]));

  // Сборка по SKU
  const bySku = new Map<string, XyzRow>();
  for (const g of grouped) {
    const key = g.nomenclatureId || g.nomenclatureName || '—';
    let row = bySku.get(key);
    if (!row) {
      row = {
        nomenclatureId: g.nomenclatureId,
        name: g.nomenclatureName || '—',
        category: g.nomenclatureId ? nomToCat.get(g.nomenclatureId) || null : null,
        totalRevenue: 0,
        totalQuantity: 0,
        mean: 0,
        stddev: 0,
        cv: 0,
        monthsWithSales: 0,
        monthsInPeriod: monthsCount,
        singleMonth: false,
        xyzClass: 'Z',
        byMonth: {},
      };
      bySku.set(key, row);
    }
    row.totalRevenue += g.amount || 0;
    row.totalQuantity += g.quantity || 0;
    const val = param === 'revenue' ? (g.amount || 0) : (g.quantity || 0);
    row.byMonth[g.ym] = (row.byMonth[g.ym] || 0) + val;
  }

  const valueOf = (r: XyzRow) => (param === 'revenue' ? r.totalRevenue : r.totalQuantity);

  // Считаем CV — обязательно по полному набору месяцев в периоде (пропуски = 0).
  for (const row of bySku.values()) {
    const series = months.map((m) => row.byMonth[m] || 0);
    const n = series.length;
    const sum = series.reduce((s, v) => s + v, 0);
    const mean = sum / n;
    const variance = n > 1
      ? series.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n
      : 0;
    const stddev = Math.sqrt(variance);
    row.mean = mean;
    row.stddev = stddev;
    row.cv = mean > 0 ? stddev / mean : 0;
    row.monthsWithSales = series.filter((v) => v > 0).length;
    row.singleMonth = row.monthsWithSales <= 1;

    // Классификация. SKU с продажами только в одном месяце за период —
    // принудительно Z, даже если математически CV=0.
    if (row.singleMonth || row.cv >= thY) row.xyzClass = 'Z';
    else if (row.cv >= thX) row.xyzClass = 'Y';
    else row.xyzClass = 'X';
  }

  const rows = Array.from(bySku.values()).sort((a, b) => valueOf(b) - valueOf(a));

  const classCounts = { X: 0, Y: 0, Z: 0 };
  const classTotals = {
    X: { revenue: 0, quantity: 0, skuCount: 0 },
    Y: { revenue: 0, quantity: 0, skuCount: 0 },
    Z: { revenue: 0, quantity: 0, skuCount: 0 },
  };
  for (const r of rows) {
    classCounts[r.xyzClass]++;
    classTotals[r.xyzClass].revenue += r.totalRevenue;
    classTotals[r.xyzClass].quantity += r.totalQuantity;
    classTotals[r.xyzClass].skuCount++;
  }

  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalQuantity = rows.reduce((s, r) => s + r.totalQuantity, 0);
  const avgMonths = rows.length
    ? rows.reduce((s, r) => s + r.monthsWithSales, 0) / rows.length
    : 0;

  return {
    param,
    from: opts.from,
    to: opts.to,
    months,
    classCounts,
    classTotals,
    totals: {
      revenue: totalRevenue,
      quantity: totalQuantity,
      skuCount: rows.length,
      avgMonths,
    },
    rows,
  };
}

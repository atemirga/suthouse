import { prisma } from '@/lib/db';
import { addMonths, format, isBefore, isAfter, parse } from 'date-fns';
import { resolvePeriod, emptyMatrix, type PeriodInput, type Granularity } from './period';

export type OpiuCategory =
  | 'revenue'
  | 'cogs'
  | 'var_expenses'
  | 'payroll'
  | 'rent'
  | 'marketing'
  | 'admin'
  | 'logistics'
  | 'taxes'
  | 'interest'
  | 'other_income'
  | 'other_expense'
  | 'capex'
  | 'financing_in'
  | 'financing_out';

export interface OpiuTotals {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  varExpenses: number;
  marginalProfit: number;
  payroll: number;
  rent: number;
  marketing: number;
  admin: number;
  logistics: number;
  amortization: number;
  ebitda: number;
  ebitdaMargin: number;
  operatingProfit: number;
  otherIncome: number;
  otherExpense: number;
  interest: number;
  ebt: number;          // Earnings Before Taxes — прибыль до налогообложения
  taxes: number;
  adjustments: number;
  netProfit: number;
  netMargin: number;
}

export type RowKind = 'header' | 'value' | 'sum' | 'pct';

export interface OpiuRow {
  id: string;
  label: string;
  level: number;
  kind: RowKind;
  category?: OpiuCategory;
  values: Record<string, number>;
  total: number;
  isPct?: boolean;
  drilldownCategory?: OpiuCategory; // для drill-down
}

export interface OpiuReport {
  from: Date;
  to: Date;
  granularity: Granularity;
  columns: string[];
  rows: OpiuRow[];
  totals: Record<string, OpiuTotals>; // по столбцам
  grandTotal: OpiuTotals;
}

interface CategoryBucket {
  byCol: Record<string, number>;
  total: number;
}

function emptyTotals(): OpiuTotals {
  return {
    revenue: 0, cogs: 0, grossProfit: 0, grossMargin: 0,
    varExpenses: 0, marginalProfit: 0,
    payroll: 0, rent: 0, marketing: 0, admin: 0, logistics: 0,
    amortization: 0, ebitda: 0, ebitdaMargin: 0,
    operatingProfit: 0,
    otherIncome: 0, otherExpense: 0, interest: 0, ebt: 0, taxes: 0,
    adjustments: 0, netProfit: 0, netMargin: 0,
  };
}

function addToBucket(buckets: Record<string, CategoryBucket>, cat: string, col: string, amount: number) {
  if (!buckets[cat]) buckets[cat] = { byCol: {}, total: 0 };
  buckets[cat].byCol[col] = (buckets[cat].byCol[col] || 0) + amount;
  buckets[cat].total += amount;
}

export async function buildOpiu(input: PeriodInput): Promise<OpiuReport> {
  const period = resolvePeriod(input);
  const buckets: Record<string, CategoryBucket> = {};

  // 1. Выручка и себестоимость — из реализаций
  const realizacii = await prisma.realizacia.findMany({
    where: { date: { gte: period.from, lte: period.to }, posted: true },
    select: { date: true, totalAmount: true, totalCost: true },
  });
  for (const r of realizacii) {
    const col = period.bucketOf(r.date);
    addToBucket(buckets, 'revenue', col, r.totalAmount);
    addToBucket(buckets, 'cogs', col, r.totalCost);
  }

  // 2. Расходы — из ДДС, сгруппированы по DdsArticle.opiuCategory
  // С учётом AccrualRule: размазываем по месяцам (только для granularity=month/week)
  const dds = await prisma.ddsDocument.findMany({
    where: {
      date: { gte: period.from, lte: period.to },
      direction: 'outflow',
      // не учитываем перемещения
      docType: { not: 'PeremeschenieDC' },
      articleId: { not: null },
    },
    select: { date: true, amount: true, articleId: true },
  });
  // Так же приходные операции, помеченные как other_income
  const ddsIn = await prisma.ddsDocument.findMany({
    where: {
      date: { gte: period.from, lte: period.to },
      direction: 'inflow',
      docType: { not: 'PeremeschenieDC' },
      articleId: { not: null },
    },
    select: { date: true, amount: true, articleId: true },
  });

  const articles = await prisma.ddsArticle.findMany({
    where: { opiuCategory: { not: null } },
    select: { id: true, opiuCategory: true },
  });
  const artCat = new Map(articles.map((a) => [a.id, a.opiuCategory!]));

  const accruals = await prisma.accrualRule.findMany();
  const accrualMap = new Map(accruals.map((a) => [a.articleId, a]));

  function addExpense(date: Date, articleId: string, amount: number, sign: 1 | -1) {
    const cat = artCat.get(articleId);
    if (!cat) return;
    // Выручка и себестоимость в ОПиУ берутся ИЗ РЕАЛИЗАЦИЙ (метод начисления),
    // а не из ДДС (кассовый метод). Соответствующие статьи ДДС используются только
    // в ДДС-отчёте, чтобы не было двойного учёта.
    if (cat === 'revenue' || cat === 'cogs') return;
    // Перемещения денег и финансирование вход/выход — не расход в ОПиУ
    if (cat === 'transfer') return;

    const accrual = accrualMap.get(articleId);
    if (accrual && accrual.months > 1) {
      const perMonth = (amount * sign) / accrual.months;
      for (let i = 0; i < accrual.months; i++) {
        const targetDate = addMonths(date, i);
        if (isBefore(targetDate, period.from) || isAfter(targetDate, period.to)) continue;
        const col = period.bucketOf(targetDate);
        addToBucket(buckets, cat, col, perMonth);
      }
    } else {
      const col = period.bucketOf(date);
      addToBucket(buckets, cat, col, amount * sign);
    }
  }

  for (const d of dds) {
    if (!d.articleId) continue;
    addExpense(d.date, d.articleId, d.amount, 1);
  }
  for (const d of ddsIn) {
    if (!d.articleId) continue;
    const cat = artCat.get(d.articleId);
    // Только прочие доходы — обычная выручка не дублируется. financing_in
    // (получение кредитов) идёт только в ДДС.
    if (cat === 'other_income') {
      // Приход денег по статье other_income → положительная сумма в категории other_income
      const accrual = accrualMap.get(d.articleId);
      if (accrual && accrual.months > 1) {
        const perMonth = d.amount / accrual.months;
        for (let i = 0; i < accrual.months; i++) {
          const targetDate = addMonths(d.date, i);
          if (isBefore(targetDate, period.from) || isAfter(targetDate, period.to)) continue;
          const col = period.bucketOf(targetDate);
          addToBucket(buckets, 'other_income', col, perMonth);
        }
      } else {
        const col = period.bucketOf(d.date);
        addToBucket(buckets, 'other_income', col, d.amount);
      }
    }
  }

  // 3. Амортизация ОС — линейный метод, по месяцам
  const fixedAssets = await prisma.fixedAsset.findMany();
  for (const fa of fixedAssets) {
    if (fa.method !== 'linear') continue;
    const monthly = fa.cost / Math.max(1, fa.usefulMonths);
    let d = new Date(fa.startDate);
    for (let i = 0; i < fa.usefulMonths; i++) {
      if (isAfter(d, period.to)) break;
      if (!isBefore(d, period.from)) {
        const col = period.bucketOf(d);
        addToBucket(buckets, 'amortization' as any, col, monthly);
      }
      d = addMonths(d, 1);
    }
  }

  // 4. Ручные корректировки
  const adjustments = await prisma.manualAdjustment.findMany();
  for (const adj of adjustments) {
    let d: Date;
    try {
      d = parse(adj.month, 'yyyy-MM', new Date());
    } catch {
      continue;
    }
    if (isBefore(d, period.from) || isAfter(d, period.to)) continue;
    const col = period.bucketOf(d);
    addToBucket(buckets, adj.category, col, adj.amount);
  }

  // ═══ Сборка итогов ═══
  const totals: Record<string, OpiuTotals> = {};
  for (const col of period.columns) totals[col] = emptyTotals();

  function v(cat: string, col: string): number {
    return buckets[cat]?.byCol[col] || 0;
  }

  for (const col of period.columns) {
    const t = totals[col];
    t.revenue = v('revenue', col);
    t.cogs = v('cogs', col);
    t.grossProfit = t.revenue - t.cogs;
    t.grossMargin = t.revenue ? t.grossProfit / t.revenue : 0;
    t.varExpenses = v('var_expenses', col);
    t.marginalProfit = t.grossProfit - t.varExpenses;
    t.payroll = v('payroll', col);
    t.rent = v('rent', col);
    t.marketing = v('marketing', col);
    t.admin = v('admin', col);
    t.logistics = v('logistics', col);
    t.amortization = v('amortization', col);
    const opex = t.payroll + t.rent + t.marketing + t.admin + t.logistics;
    t.ebitda = t.marginalProfit - opex;
    t.ebitdaMargin = t.revenue ? t.ebitda / t.revenue : 0;
    t.operatingProfit = t.ebitda - t.amortization;
    t.otherIncome = v('other_income', col);
    t.otherExpense = v('other_expense', col);
    t.interest = v('interest', col);
    // EBT (Earnings Before Taxes) — прибыль до налогов: Опер. прибыль + прочие доходы/расходы − проценты
    t.ebt = t.operatingProfit + t.otherIncome - t.otherExpense - t.interest;
    t.taxes = v('taxes', col);
    t.adjustments = v('adjustments_misc' as any, col); // зарезервировано
    t.netProfit = t.ebt - t.taxes + t.adjustments;
    t.netMargin = t.revenue ? t.netProfit / t.revenue : 0;
  }

  // Grand total — сумма по всем столбцам
  const grand = emptyTotals();
  for (const col of period.columns) {
    grand.revenue += totals[col].revenue;
    grand.cogs += totals[col].cogs;
    grand.varExpenses += totals[col].varExpenses;
    grand.payroll += totals[col].payroll;
    grand.rent += totals[col].rent;
    grand.marketing += totals[col].marketing;
    grand.admin += totals[col].admin;
    grand.logistics += totals[col].logistics;
    grand.amortization += totals[col].amortization;
    grand.otherIncome += totals[col].otherIncome;
    grand.otherExpense += totals[col].otherExpense;
    grand.taxes += totals[col].taxes;
    grand.interest += totals[col].interest;
    grand.adjustments += totals[col].adjustments;
  }
  grand.grossProfit = grand.revenue - grand.cogs;
  grand.grossMargin = grand.revenue ? grand.grossProfit / grand.revenue : 0;
  grand.marginalProfit = grand.grossProfit - grand.varExpenses;
  grand.ebitda = grand.marginalProfit - grand.payroll - grand.rent - grand.marketing - grand.admin - grand.logistics;
  grand.ebitdaMargin = grand.revenue ? grand.ebitda / grand.revenue : 0;
  grand.operatingProfit = grand.ebitda - grand.amortization;
  grand.ebt = grand.operatingProfit + grand.otherIncome - grand.otherExpense - grand.interest;
  grand.netProfit = grand.ebt - grand.taxes + grand.adjustments;
  grand.netMargin = grand.revenue ? grand.netProfit / grand.revenue : 0;

  // ═══ Строки отчёта ═══
  const rows: OpiuRow[] = [];
  function addRow(id: string, label: string, level: number, kind: RowKind, getter: (t: OpiuTotals) => number, isPct?: boolean, drill?: OpiuCategory) {
    const values: Record<string, number> = {};
    for (const col of period.columns) values[col] = getter(totals[col]);
    rows.push({
      id, label, level, kind, values,
      total: getter(grand),
      isPct,
      drilldownCategory: drill,
    });
  }

  addRow('revenue', 'Выручка', 0, 'value', (t) => t.revenue, false, 'revenue');
  addRow('cogs', 'Себестоимость продаж', 0, 'value', (t) => -t.cogs, false, 'cogs');
  addRow('gross_profit', 'Валовая прибыль', 0, 'sum', (t) => t.grossProfit);
  addRow('gross_margin', 'Валовая маржа, %', 1, 'pct', (t) => t.grossMargin, true);
  addRow('var_expenses', 'Переменные расходы', 0, 'value', (t) => -t.varExpenses, false, 'var_expenses');
  addRow('marginal_profit', 'Маржинальная прибыль', 0, 'sum', (t) => t.marginalProfit);
  addRow('opex_header', 'Постоянные операционные расходы', 0, 'header', () => 0);
  addRow('payroll', 'ФОТ (зарплата)', 1, 'value', (t) => -t.payroll, false, 'payroll');
  addRow('rent', 'Аренда', 1, 'value', (t) => -t.rent, false, 'rent');
  addRow('marketing', 'Маркетинг', 1, 'value', (t) => -t.marketing, false, 'marketing');
  addRow('logistics', 'Логистика', 1, 'value', (t) => -t.logistics, false, 'logistics');
  addRow('admin', 'Административные', 1, 'value', (t) => -t.admin, false, 'admin');
  addRow('ebitda', 'EBITDA — опер. прибыль до аморт./%/налогов', 0, 'sum', (t) => t.ebitda);
  addRow('ebitda_margin', 'EBITDA маржа, %', 1, 'pct', (t) => t.ebitdaMargin, true);
  addRow('amortization', 'Амортизация (D&A)', 0, 'value', (t) => -t.amortization);
  addRow('operating_profit', 'Операционная прибыль (EBIT)', 0, 'sum', (t) => t.operatingProfit);
  addRow('non_op_header', 'Внеоперационная деятельность', 0, 'header', () => 0);
  addRow('other_income', 'Прочие доходы', 1, 'value', (t) => t.otherIncome, false, 'other_income');
  addRow('other_expense', 'Прочие расходы', 1, 'value', (t) => -t.otherExpense, false, 'other_expense');
  addRow('interest', 'Проценты по кредитам', 1, 'value', (t) => -t.interest, false, 'interest');
  addRow('ebt', 'Прибыль до налогов (EBT)', 0, 'sum', (t) => t.ebt);
  addRow('taxes', 'Налог на прибыль', 0, 'value', (t) => -t.taxes, false, 'taxes');
  addRow('adjustments', 'Ручные корректировки', 0, 'value', (t) => t.adjustments);
  addRow('net_profit', 'ЧИСТАЯ ПРИБЫЛЬ', 0, 'sum', (t) => t.netProfit);
  addRow('net_margin', 'Рентабельность по чистой прибыли, %', 1, 'pct', (t) => t.netMargin, true);

  return {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    columns: period.columns,
    rows,
    totals,
    grandTotal: grand,
  };
}

// Drill-down: документы за период по категории
export async function drillOpiu(category: OpiuCategory, from: Date, to: Date) {
  if (category === 'revenue' || category === 'cogs') {
    const realizacii = await prisma.realizacia.findMany({
      where: { date: { gte: from, lte: to }, posted: true },
      orderBy: { date: 'desc' },
      take: 500,
      select: {
        id: true, date: true, number: true, kontragentName: true,
        totalAmount: true, totalCost: true, comment: true,
      },
    });
    return realizacii.map((r) => ({
      id: r.id,
      date: r.date,
      number: r.number,
      counterparty: r.kontragentName,
      amount: category === 'revenue' ? r.totalAmount : r.totalCost,
      comment: r.comment,
    }));
  }
  // Расходы / прочие — из ДДС
  const articles = await prisma.ddsArticle.findMany({
    where: { opiuCategory: category },
    select: { id: true },
  });
  const articleIds = articles.map((a) => a.id);
  if (articleIds.length === 0) return [];

  const docs = await prisma.ddsDocument.findMany({
    where: {
      date: { gte: from, lte: to },
      articleId: { in: articleIds },
      docType: { not: 'PeremeschenieDC' },
    },
    orderBy: { date: 'desc' },
    take: 500,
    select: {
      id: true, date: true, number: true, kontragentName: true,
      articleName: true, amount: true, comment: true, direction: true,
    },
  });
  return docs.map((d) => ({
    id: d.id,
    date: d.date,
    number: d.number,
    counterparty: d.kontragentName,
    article: d.articleName,
    amount: d.amount,
    comment: d.comment,
  }));
}

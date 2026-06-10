// Структура расходов — кассовый метод (фактические выплаты из ДДС).
// Источник: DdsDocument с direction='outflow', сгруппировано по DdsArticle.opiuCategory.
// Внутренние перемещения (direction='transfer', PeremeschenieDC) ИСКЛЮЧАЮТСЯ —
// они не операционные расходы, а движение денег между нашими счетами.
//
// Это НЕ accrual: ЗП-выплата 5 марта за февраль попадёт в март (cash-дата),
// а в ОПиУ она же — в феврале. Налог на прибыль здесь = cash 1.38 (часто 0,
// налог платится 2 раза в год), а в ОПиУ — расчётный 2%. Расхождение с ОПиУ
// нормально.
//
// Возвращает: данные текущего периода + предыдущего того же размера + тренд
// по последним 6 месяцам + топ-контрагенты внутри категорий.

import { prisma } from '@/lib/db';
import { addMonths, addDays, differenceInDays, startOfMonth, endOfMonth, format } from 'date-fns';

export interface ExpenseArticle {
  name: string;
  amount: number;
  prevAmount: number;
  docCount: number;
  share: number; // доля внутри категории
}

export interface ExpenseRow {
  category: string;
  label: string;
  amount: number;
  prevAmount: number;
  delta: number;            // amount − prevAmount
  deltaPct: number;         // в процентах от prevAmount; 0 если prev=0
  share: number;            // доля от total в %
  docCount: number;
  articles: ExpenseArticle[];
  topKontragenty: { name: string; amount: number; docCount: number }[];
}

export interface MonthlyTrendPoint {
  month: string;            // YYYY-MM
  label: string;            // «апр.26»
  total: number;
  byCategory: Record<string, number>;
}

export interface ExpensesReport {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  daysInPeriod: number;
  total: number;
  prevTotal: number;
  delta: number;
  deltaPct: number;
  avgPerDay: number;
  docCount: number;
  prevDocCount: number;
  biggestCategory: { label: string; amount: number; share: number } | null;
  rows: ExpenseRow[];
  monthlyTrend: MonthlyTrendPoint[];
  categoriesOrder: string[]; // порядок категорий (для устойчивого окрашивания в UI)
}

const CATEGORY_LABELS: Record<string, string> = {
  cogs: 'Себестоимость',
  payroll: 'ФОТ',
  rent: 'Аренда',
  marketing: 'Маркетинг',
  admin: 'Администр.',
  logistics: 'Логистика',
  amortization: 'Амортизация',
  taxes: 'Налоги',
  interest: 'Проценты',
  other_expense: 'Прочие',
  var_expenses: 'Переменные',
  capex: 'Капвложения',
  financing_out: 'Выплаты собств.',
  '': 'Без категории',
};

const MONTH_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

interface OutflowRow {
  amount: number;
  articleId: string | null;
  articleName: string | null;
  kontragentName: string | null;
  date: Date;
}

async function fetchOutflows(from: Date, to: Date): Promise<OutflowRow[]> {
  return prisma.ddsDocument.findMany({
    where: {
      direction: 'outflow',
      date: { gte: from, lte: to },
    },
    select: { amount: true, articleId: true, articleName: true, kontragentName: true, date: true },
  });
}

export async function buildExpenses(opts: { from: Date; to: Date }): Promise<ExpensesReport> {
  // 1. Сразу считаем границы предыдущего периода (того же размера, прилегающего)
  const daysInPeriod = Math.max(1, differenceInDays(opts.to, opts.from) + 1);
  const prevTo = addDays(opts.from, -1);
  const prevFrom = addDays(prevTo, -(daysInPeriod - 1));

  // 2. Границы тренда — последние 6 месяцев, заканчивая месяцем opts.to
  const trendEnd = endOfMonth(opts.to);
  const trendStart = startOfMonth(addMonths(trendEnd, -5));

  const [docs, prevDocs, articles, trendDocs] = await Promise.all([
    fetchOutflows(opts.from, opts.to),
    fetchOutflows(prevFrom, prevTo),
    prisma.ddsArticle.findMany({ select: { id: true, opiuCategory: true } }),
    fetchOutflows(trendStart, trendEnd),
  ]);

  const articleCat = new Map(articles.map((a) => [a.id, a.opiuCategory || '']));
  function catOf(articleId: string | null): string {
    return articleId ? articleCat.get(articleId) || '' : '';
  }

  // 3. Текущий период — агрегация
  type Bucket = {
    amount: number;
    docCount: number;
    articles: Map<string, { amount: number; docCount: number }>;
    kontragenty: Map<string, { amount: number; docCount: number }>;
  };
  const byCat = new Map<string, Bucket>();
  function ensureBucket(c: string): Bucket {
    let b = byCat.get(c);
    if (!b) { b = { amount: 0, docCount: 0, articles: new Map(), kontragenty: new Map() }; byCat.set(c, b); }
    return b;
  }
  for (const d of docs) {
    const c = catOf(d.articleId);
    const b = ensureBucket(c);
    b.amount += d.amount;
    b.docCount++;
    const aname = d.articleName || '[без статьи]';
    const cur = b.articles.get(aname) || { amount: 0, docCount: 0 };
    cur.amount += d.amount; cur.docCount++;
    b.articles.set(aname, cur);
    if (d.kontragentName) {
      const k = b.kontragenty.get(d.kontragentName) || { amount: 0, docCount: 0 };
      k.amount += d.amount; k.docCount++;
      b.kontragenty.set(d.kontragentName, k);
    }
  }

  // 4. Предыдущий период — только суммы (по категории и по статье)
  const prevByCat = new Map<string, { amount: number; articles: Map<string, number> }>();
  for (const d of prevDocs) {
    const c = catOf(d.articleId);
    let b = prevByCat.get(c);
    if (!b) { b = { amount: 0, articles: new Map() }; prevByCat.set(c, b); }
    b.amount += d.amount;
    const aname = d.articleName || '[без статьи]';
    b.articles.set(aname, (b.articles.get(aname) || 0) + d.amount);
  }

  const total = Array.from(byCat.values()).reduce((s, b) => s + b.amount, 0);
  const prevTotal = Array.from(prevByCat.values()).reduce((s, b) => s + b.amount, 0);

  const rows: ExpenseRow[] = Array.from(byCat.entries()).map(([category, b]) => {
    const prev = prevByCat.get(category);
    const prevAmount = prev?.amount || 0;
    const delta = b.amount - prevAmount;
    const deltaPct = prevAmount > 0 ? (delta / prevAmount) * 100 : 0;
    const articles: ExpenseArticle[] = Array.from(b.articles.entries())
      .map(([name, a]) => ({
        name,
        amount: a.amount,
        prevAmount: prev?.articles.get(name) || 0,
        docCount: a.docCount,
        share: b.amount > 0 ? (a.amount / b.amount) * 100 : 0,
      }))
      .sort((x, y) => y.amount - x.amount);
    const topKontragenty = Array.from(b.kontragenty.entries())
      .map(([name, k]) => ({ name, amount: k.amount, docCount: k.docCount }))
      .sort((x, y) => y.amount - x.amount)
      .slice(0, 5);
    return {
      category,
      label: CATEGORY_LABELS[category] || category,
      amount: b.amount,
      prevAmount,
      delta,
      deltaPct,
      share: total > 0 ? (b.amount / total) * 100 : 0,
      docCount: b.docCount,
      articles,
      topKontragenty,
    };
  }).sort((a, b) => b.amount - a.amount);

  // 5. Тренд по месяцам — все за trendStart..trendEnd
  const monthBuckets: Record<string, { total: number; byCategory: Record<string, number> }> = {};
  for (let cur = startOfMonth(trendStart); cur <= trendEnd; cur = addMonths(cur, 1)) {
    const key = format(cur, 'yyyy-MM');
    monthBuckets[key] = { total: 0, byCategory: {} };
  }
  for (const d of trendDocs) {
    const key = format(d.date, 'yyyy-MM');
    if (!monthBuckets[key]) continue;
    const c = catOf(d.articleId);
    monthBuckets[key].total += d.amount;
    monthBuckets[key].byCategory[c] = (monthBuckets[key].byCategory[c] || 0) + d.amount;
  }
  const monthlyTrend: MonthlyTrendPoint[] = Object.entries(monthBuckets).map(([month, v]) => {
    const [y, m] = month.split('-');
    const label = `${MONTH_RU[Number(m) - 1]}.${y.slice(2)}`;
    return { month, label, total: v.total, byCategory: v.byCategory };
  });

  const docCount = docs.length;
  const prevDocCount = prevDocs.length;
  const biggest = rows[0] ? { label: rows[0].label, amount: rows[0].amount, share: rows[0].share } : null;

  return {
    from: opts.from,
    to: opts.to,
    prevFrom,
    prevTo,
    daysInPeriod,
    total,
    prevTotal,
    delta: total - prevTotal,
    deltaPct: prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0,
    avgPerDay: total / daysInPeriod,
    docCount,
    prevDocCount,
    biggestCategory: biggest,
    rows,
    monthlyTrend,
    categoriesOrder: rows.map((r) => r.category),
  };
}

// Drill-down: список документов выбранной категории за период
export async function drillExpenseCategory(
  category: string,
  from: Date,
  to: Date,
  articleName?: string,
): Promise<Array<{ id: string; date: Date; number: string; counterparty: string | null; article: string | null; amount: number; comment: string | null }>> {
  const arts = await prisma.ddsArticle.findMany({
    where: { opiuCategory: category || null },
    select: { id: true },
  });
  const articleIds = arts.map((a) => a.id);
  const where: any = {
    direction: 'outflow',
    date: { gte: from, lte: to },
  };
  if (articleName && articleName !== '[без статьи]') {
    where.articleName = articleName;
  } else if (articleIds.length > 0) {
    where.articleId = { in: articleIds };
  } else {
    where.articleId = null;
  }
  const docs = await prisma.ddsDocument.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 500,
    select: {
      id: true, date: true, number: true, kontragentName: true,
      articleName: true, amount: true, comment: true,
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

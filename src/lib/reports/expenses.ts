// Структура расходов — pie + table по категориям ОПиУ.
// Дополнительно: разрез по статьям ДДС внутри категории (для дрилл-дауна).

import { prisma } from '@/lib/db';

export interface ExpenseRow {
  category: string;
  label: string;
  amount: number;
  share: number;
  articles: { name: string; amount: number }[];
}

export interface ExpensesReport {
  from: Date;
  to: Date;
  total: number;
  rows: ExpenseRow[];
}

const CATEGORY_LABELS: Record<string, string> = {
  cogs: 'Себестоимость',
  payroll: 'ФОТ',
  rent: 'Аренда',
  marketing: 'Маркетинг',
  admin: 'Администрат.',
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

export async function buildExpenses(opts: { from: Date; to: Date }): Promise<ExpensesReport> {
  const [docs, articles] = await Promise.all([
    prisma.ddsDocument.findMany({
      where: {
        direction: 'outflow',
        docType: { not: 'PeremeschenieDC' },
        date: { gte: opts.from, lte: opts.to },
      },
      select: { amount: true, articleId: true, articleName: true },
    }),
    prisma.ddsArticle.findMany({ select: { id: true, opiuCategory: true } }),
  ]);

  const cat = new Map(articles.map((a) => [a.id, a.opiuCategory || '']));
  const byCat = new Map<string, { amount: number; articles: Map<string, number> }>();

  for (const d of docs) {
    const c = (d.articleId ? cat.get(d.articleId) : '') || '';
    let bucket = byCat.get(c);
    if (!bucket) { bucket = { amount: 0, articles: new Map() }; byCat.set(c, bucket); }
    bucket.amount += d.amount;
    const aname = d.articleName || '[без статьи]';
    bucket.articles.set(aname, (bucket.articles.get(aname) || 0) + d.amount);
  }

  const total = Array.from(byCat.values()).reduce((s, b) => s + b.amount, 0);

  const rows: ExpenseRow[] = Array.from(byCat.entries()).map(([category, b]) => ({
    category,
    label: CATEGORY_LABELS[category] || category,
    amount: b.amount,
    share: total > 0 ? (b.amount / total) * 100 : 0,
    articles: Array.from(b.articles.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount),
  })).sort((a, b) => b.amount - a.amount);

  return { from: opts.from, to: opts.to, total, rows };
}

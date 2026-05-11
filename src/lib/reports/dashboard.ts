import { prisma } from '@/lib/db';
import { resolvePeriod, type PeriodInput } from './period';
import { buildOpiu } from './opiu';

export interface DashboardData {
  from: Date;
  to: Date;
  granularity: 'day' | 'week' | 'month';
  columns: string[];
  // Главные KPI
  kpi: {
    revenue: number;
    grossProfit: number;
    grossMargin: number;
    ebitda: number;
    ebitdaMargin: number;
    netProfit: number;
    netMargin: number;
    cashIn: number;
    cashOut: number;
    netCashFlow: number;
    avgCheck: number; // средний чек по реализациям
    txCount: number;  // транзакций (реализаций)
    activeOrders: number;
  };
  // Сравнение с предыдущим периодом (% delta)
  deltas: {
    revenue: number;
    netProfit: number;
    netCashFlow: number;
  };
  // Помесячные / понедельные / подневные ряды
  series: {
    period: string;
    revenue: number;
    cogs: number;
    grossProfit: number;
    ebitda: number;
    netProfit: number;
    cashIn: number;
    cashOut: number;
  }[];
  // Структура расходов (для pie/bar)
  expenseBreakdown: { category: string; label: string; amount: number }[];
  // Структура поступлений ДДС (по статьям)
  inflowBreakdown: { article: string; amount: number }[];
  // Топ контрагентов по выручке
  topCustomers: { name: string; revenue: number; orders: number }[];
  // Топ товаров по выручке
  topProducts: { name: string; revenue: number; quantity: number; margin: number }[];
}

const CATEGORY_LABELS: Record<string, string> = {
  payroll: 'ФОТ', rent: 'Аренда', marketing: 'Маркетинг', admin: 'Администрат.',
  logistics: 'Логистика', taxes: 'Налоги', interest: 'Проценты',
  other_expense: 'Прочие расходы', var_expenses: 'Переменные', amortization: 'Амортизация',
};

export async function buildDashboard(input: PeriodInput): Promise<DashboardData> {
  const period = resolvePeriod(input);

  // Подсчёт длительности периода для предыдущего сравнительного
  const periodMs = period.to.getTime() - period.from.getTime();
  const prevTo = new Date(period.from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  const [report, prevReport, dds, ddsPrev, realStats, orderStats, topCust, topProd, articles] = await Promise.all([
    buildOpiu({ from: period.from, to: period.to, granularity: period.granularity }),
    buildOpiu({ from: prevFrom, to: prevTo, granularity: period.granularity }),
    prisma.ddsDocument.findMany({
      where: { date: { gte: period.from, lte: period.to }, docType: { not: 'PeremeschenieDC' } },
      select: { date: true, amount: true, direction: true, articleId: true, articleName: true },
    }),
    prisma.ddsDocument.findMany({
      where: { date: { gte: prevFrom, lte: prevTo }, docType: { not: 'PeremeschenieDC' } },
      select: { amount: true, direction: true },
    }),
    prisma.realizacia.aggregate({
      where: { date: { gte: period.from, lte: period.to }, posted: true },
      _count: true,
      _sum: { totalAmount: true, totalCost: true },
    }),
    prisma.orderBuyer.count({ where: { posted: true } }),
    prisma.realizacia.groupBy({
      by: ['kontragentName'],
      where: { date: { gte: period.from, lte: period.to }, posted: true },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 10,
    }),
    prisma.realizaciaItem.groupBy({
      by: ['nomenclatureName'],
      where: { realizacia: { date: { gte: period.from, lte: period.to }, posted: true } },
      _sum: { amount: true, quantity: true, costAmount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 10,
    }),
    prisma.ddsArticle.findMany({ select: { id: true, ddsSection: true } }),
  ]);

  const sectionMap = new Map(articles.map((a) => [a.id, a.ddsSection || 'operating']));

  // Серии по периодам
  const seriesMap = new Map<string, any>();
  for (const col of period.columns) {
    seriesMap.set(col, {
      period: col,
      revenue: report.totals[col]?.revenue || 0,
      cogs: report.totals[col]?.cogs || 0,
      grossProfit: report.totals[col]?.grossProfit || 0,
      ebitda: report.totals[col]?.ebitda || 0,
      netProfit: report.totals[col]?.netProfit || 0,
      cashIn: 0,
      cashOut: 0,
    });
  }
  let totalCashIn = 0;
  let totalCashOut = 0;
  for (const d of dds) {
    const col = period.bucketOf(d.date);
    const row = seriesMap.get(col);
    if (!row) continue;
    if (d.direction === 'inflow') {
      row.cashIn += d.amount;
      totalCashIn += d.amount;
    } else if (d.direction === 'outflow') {
      row.cashOut += d.amount;
      totalCashOut += d.amount;
    }
  }
  const series = Array.from(seriesMap.values());

  // Прошлый период для cash
  let prevCashIn = 0, prevCashOut = 0;
  for (const d of ddsPrev) {
    if (d.direction === 'inflow') prevCashIn += d.amount;
    else if (d.direction === 'outflow') prevCashOut += d.amount;
  }

  // Структура расходов из отчёта
  const exp = report.grandTotal;
  const expenseBreakdown = ([
    ['cogs', 'Себестоимость', exp.cogs],
    ['payroll', 'ФОТ', exp.payroll],
    ['rent', 'Аренда', exp.rent],
    ['marketing', 'Маркетинг', exp.marketing],
    ['admin', 'Администрат.', exp.admin],
    ['logistics', 'Логистика', exp.logistics],
    ['amortization', 'Амортизация', exp.amortization],
    ['taxes', 'Налоги', exp.taxes],
    ['interest', 'Проценты', exp.interest],
    ['other_expense', 'Прочие', exp.otherExpense],
    ['var_expenses', 'Переменные', exp.varExpenses],
  ] as Array<[string, string, number]>)
    .filter(([_, __, v]) => v > 0)
    .map(([category, label, amount]) => ({ category, label, amount }));

  // Структура поступлений ДДС
  const inflowMap = new Map<string, number>();
  for (const d of dds) {
    if (d.direction !== 'inflow') continue;
    const key = d.articleName || '[без статьи]';
    inflowMap.set(key, (inflowMap.get(key) || 0) + d.amount);
  }
  const inflowBreakdown = Array.from(inflowMap.entries())
    .map(([article, amount]) => ({ article, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Активные заказы (с долгом по отгрузке)
  const activeOrders = await prisma.orderBuyer.count({
    where: { posted: true },
  });

  const totalRevenue = realStats._sum.totalAmount || 0;
  const txCount = realStats._count;
  const avgCheck = txCount > 0 ? totalRevenue / txCount : 0;

  function delta(curr: number, prev: number): number {
    if (prev === 0) return curr === 0 ? 0 : 100;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  return {
    from: period.from,
    to: period.to,
    granularity: period.granularity,
    columns: period.columns,
    kpi: {
      revenue: report.grandTotal.revenue,
      grossProfit: report.grandTotal.grossProfit,
      grossMargin: report.grandTotal.grossMargin,
      ebitda: report.grandTotal.ebitda,
      ebitdaMargin: report.grandTotal.ebitdaMargin,
      netProfit: report.grandTotal.netProfit,
      netMargin: report.grandTotal.netMargin,
      cashIn: totalCashIn,
      cashOut: totalCashOut,
      netCashFlow: totalCashIn - totalCashOut,
      avgCheck,
      txCount,
      activeOrders,
    },
    deltas: {
      revenue: delta(report.grandTotal.revenue, prevReport.grandTotal.revenue),
      netProfit: delta(report.grandTotal.netProfit, prevReport.grandTotal.netProfit),
      netCashFlow: delta(totalCashIn - totalCashOut, prevCashIn - prevCashOut),
    },
    series,
    expenseBreakdown,
    inflowBreakdown,
    topCustomers: topCust.map((c) => ({
      name: c.kontragentName || '—',
      revenue: c._sum.totalAmount || 0,
      orders: c._count,
    })),
    topProducts: topProd.map((p) => {
      const rev = p._sum.amount || 0;
      const cost = p._sum.costAmount || 0;
      const margin = rev > 0 ? (rev - cost) / rev : 0;
      return {
        name: p.nomenclatureName || '—',
        revenue: rev,
        quantity: p._sum.quantity || 0,
        margin,
      };
    }),
  };
}

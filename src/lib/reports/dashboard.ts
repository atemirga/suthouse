import { prisma } from '@/lib/db';
import { resolvePeriod, type PeriodInput } from './period';
import { buildOpiu } from './opiu';
import { buildReceivables, AGING_BUCKETS, type BucketKey } from './receivables';

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
    avgCheck: number;
    txCount: number;
    activeOrders: number;
    // Новые
    cashBalance: number;        // суммарный остаток денег
    receivablesTotal: number;   // дебиторка всего
    receivablesOverdue30: number; // просрочка 30+ дн
    receivablesCount: number;   // число должников
    prepayments: number;        // авансы получ.
    discountsGiven: number;     // дано скидок за период
  };
  // Сравнение с предыдущим периодом (% delta)
  deltas: {
    revenue: number;
    netProfit: number;
    netCashFlow: number;
    grossMargin: number;
  };
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
  expenseBreakdown: { category: string; label: string; amount: number }[];
  inflowBreakdown: { article: string; amount: number }[];
  topCustomers: { name: string; revenue: number; orders: number }[];
  topProducts: { name: string; revenue: number; quantity: number; margin: number }[];
  // Новые блоки
  receivablesAging: { key: BucketKey; label: string; color: string; amount: number }[];
  topDebtors: { name: string; debt: number; oldestDays: number }[];
  cashPositions: { name: string; type: 'kassa' | 'bank'; balance: number }[];
  salesByManager: { name: string; revenue: number; orders: number; avgCheck: number }[];
}

export async function buildDashboard(input: PeriodInput): Promise<DashboardData> {
  const period = resolvePeriod(input);

  const periodMs = period.to.getTime() - period.from.getTime();
  const prevTo = new Date(period.from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  const [
    report,
    prevReport,
    dds,
    ddsPrev,
    allDdsForBalance,
    realStats,
    activeOrders,
    topCust,
    topProd,
    articles,
    receivables,
    discountAgg,
    salesByMgr,
  ] = await Promise.all([
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
    // Все ДДС до конца периода — для расчёта остатков касс/счетов
    prisma.ddsDocument.findMany({
      where: { date: { lte: period.to } },
      select: {
        amount: true,
        direction: true,
        docType: true,
        kassaId: true,
        kassaName: true,
        kassaToId: true,
        kassaToName: true,
        accountId: true,
        accountName: true,
      },
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
    buildReceivables({ asOf: period.to, limit: 10 }),
    prisma.realizaciaItem.aggregate({
      where: { realizacia: { date: { gte: period.from, lte: period.to }, posted: true } },
      _sum: { discount: true },
    }),
    prisma.realizacia.groupBy({
      by: ['responsibleName'],
      where: { date: { gte: period.from, lte: period.to }, posted: true, responsibleName: { not: null } },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: 8,
    }),
  ]);

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

  // Остатки по кассам и банковским счетам.
  // Учитываем перемещения: kassaId — откуда (− сумма), kassaToId — куда (+ сумма).
  const cashByKassa = new Map<string, number>();
  const cashByAccount = new Map<string, number>();
  for (const d of allDdsForBalance) {
    if (d.docType === 'PeremeschenieDC') {
      if (d.kassaId && d.kassaName) {
        cashByKassa.set(d.kassaName, (cashByKassa.get(d.kassaName) || 0) - d.amount);
      }
      if (d.kassaToId && d.kassaToName) {
        cashByKassa.set(d.kassaToName, (cashByKassa.get(d.kassaToName) || 0) + d.amount);
      }
      continue;
    }
    const sign = d.direction === 'inflow' ? 1 : d.direction === 'outflow' ? -1 : 0;
    if (sign === 0) continue;
    if (d.kassaId && d.kassaName) {
      cashByKassa.set(d.kassaName, (cashByKassa.get(d.kassaName) || 0) + sign * d.amount);
    }
    if (d.accountId && d.accountName) {
      cashByAccount.set(d.accountName, (cashByAccount.get(d.accountName) || 0) + sign * d.amount);
    }
  }
  const cashPositions = [
    ...Array.from(cashByKassa.entries()).map(([name, balance]) => ({ name, type: 'kassa' as const, balance })),
    ...Array.from(cashByAccount.entries()).map(([name, balance]) => ({ name, type: 'bank' as const, balance })),
  ]
    .filter((p) => Math.abs(p.balance) > 1)
    .sort((a, b) => b.balance - a.balance);

  const totalCashBalance = cashPositions.reduce((s, p) => s + p.balance, 0);

  // Сводка дебиторки
  const receivablesAging = AGING_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    color: b.color,
    amount: receivables.totals.buckets[b.key] || 0,
  }));
  const topDebtors = receivables.rows
    .filter((r) => r.totalDebt > 0)
    .slice(0, 10)
    .map((r) => ({ name: r.kontragentName, debt: r.totalDebt, oldestDays: r.oldestDays }));

  // Продажи по менеджерам
  const salesByManager = salesByMgr.map((m) => {
    const revenue = m._sum.totalAmount || 0;
    const orders = m._count;
    return {
      name: m.responsibleName || '—',
      revenue,
      orders,
      avgCheck: orders > 0 ? revenue / orders : 0,
    };
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
      cashBalance: totalCashBalance,
      receivablesTotal: receivables.totals.debt,
      receivablesOverdue30: receivables.totals.overdue30Plus,
      receivablesCount: receivables.totals.debtorCount,
      prepayments: receivables.totals.prepayments,
      discountsGiven: discountAgg._sum.discount || 0,
    },
    deltas: {
      revenue: delta(report.grandTotal.revenue, prevReport.grandTotal.revenue),
      netProfit: delta(report.grandTotal.netProfit, prevReport.grandTotal.netProfit),
      netCashFlow: delta(totalCashIn - totalCashOut, prevCashIn - prevCashOut),
      grossMargin: delta(report.grandTotal.grossMargin, prevReport.grandTotal.grossMargin),
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
    receivablesAging,
    topDebtors,
    cashPositions,
    salesByManager,
  };
}

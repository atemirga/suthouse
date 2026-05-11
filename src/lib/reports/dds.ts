import { prisma } from '@/lib/db';
import { resolvePeriod, type PeriodInput, type Granularity } from './period';

export interface DdsFilters extends PeriodInput {
  kassaIds?: string[];
  accountIds?: string[];
  articleIds?: string[];
  kontragentIds?: string[];
  search?: string;
}

export interface DdsTotals {
  inflowOperating: number;
  outflowOperating: number;
  netOperating: number;
  inflowInvesting: number;
  outflowInvesting: number;
  netInvesting: number;
  inflowFinancing: number;
  outflowFinancing: number;
  netFinancing: number;
  netFlow: number;
}

export interface DdsArticleRow {
  articleId: string | null;
  articleName: string;
  section: string; // operating | investing | financing | other
  direction: 'inflow' | 'outflow';
  values: Record<string, number>;
  total: number;
}

export interface DdsReport {
  from: Date;
  to: Date;
  granularity: Granularity;
  columns: string[];
  rows: DdsArticleRow[];
  totals: Record<string, DdsTotals>;
  grandTotal: DdsTotals;
}

function emptyTotals(): DdsTotals {
  return {
    inflowOperating: 0, outflowOperating: 0, netOperating: 0,
    inflowInvesting: 0, outflowInvesting: 0, netInvesting: 0,
    inflowFinancing: 0, outflowFinancing: 0, netFinancing: 0,
    netFlow: 0,
  };
}

export async function buildDds(input: DdsFilters): Promise<DdsReport> {
  const period = resolvePeriod(input);

  const where: any = {
    date: { gte: period.from, lte: period.to },
    docType: { not: 'PeremeschenieDC' }, // перемещения исключаем
  };
  if (input.kassaIds?.length) where.kassaId = { in: input.kassaIds };
  if (input.accountIds?.length) where.accountId = { in: input.accountIds };
  if (input.articleIds?.length) where.articleId = { in: input.articleIds };
  if (input.kontragentIds?.length) where.kontragentId = { in: input.kontragentIds };
  if (input.search) where.comment = { contains: input.search, mode: 'insensitive' };

  const docs = await prisma.ddsDocument.findMany({
    where,
    select: {
      date: true, amount: true, direction: true,
      articleId: true, articleName: true,
    },
  });

  // Раздел ДДС берём из DdsArticle
  const articles = await prisma.ddsArticle.findMany({
    select: { id: true, name: true, ddsSection: true, opiuCategory: true },
  });
  const sectionMap = new Map<string, string>();
  for (const a of articles) sectionMap.set(a.id, a.ddsSection || 'operating');

  // Группировка по (articleId, direction)
  const byArt = new Map<string, DdsArticleRow>();

  function getOrInit(articleId: string | null, articleName: string, direction: 'inflow' | 'outflow'): DdsArticleRow {
    const key = `${articleId || '-'}|${direction}`;
    if (!byArt.has(key)) {
      const section = articleId ? sectionMap.get(articleId) || 'operating' : 'operating';
      const row: DdsArticleRow = {
        articleId,
        articleName: articleName || '[без статьи]',
        section,
        direction,
        values: Object.fromEntries(period.columns.map((c) => [c, 0])),
        total: 0,
      };
      byArt.set(key, row);
    }
    return byArt.get(key)!;
  }

  const totals: Record<string, DdsTotals> = {};
  for (const col of period.columns) totals[col] = emptyTotals();

  for (const d of docs) {
    if (d.direction !== 'inflow' && d.direction !== 'outflow') continue;
    const col = period.bucketOf(d.date);
    const row = getOrInit(d.articleId, d.articleName || '[без статьи]', d.direction);
    row.values[col] += d.amount;
    row.total += d.amount;

    const section = row.section;
    const t = totals[col];
    if (section === 'operating' || (!section)) {
      if (d.direction === 'inflow') t.inflowOperating += d.amount;
      else t.outflowOperating += d.amount;
    } else if (section === 'investing') {
      if (d.direction === 'inflow') t.inflowInvesting += d.amount;
      else t.outflowInvesting += d.amount;
    } else if (section === 'financing') {
      if (d.direction === 'inflow') t.inflowFinancing += d.amount;
      else t.outflowFinancing += d.amount;
    }
    // section=transfer уже отфильтрован выше через docType, на всякий — пропускаем
  }

  for (const col of period.columns) {
    const t = totals[col];
    t.netOperating = t.inflowOperating - t.outflowOperating;
    t.netInvesting = t.inflowInvesting - t.outflowInvesting;
    t.netFinancing = t.inflowFinancing - t.outflowFinancing;
    t.netFlow = t.netOperating + t.netInvesting + t.netFinancing;
  }

  const grand = emptyTotals();
  for (const col of period.columns) {
    grand.inflowOperating += totals[col].inflowOperating;
    grand.outflowOperating += totals[col].outflowOperating;
    grand.inflowInvesting += totals[col].inflowInvesting;
    grand.outflowInvesting += totals[col].outflowInvesting;
    grand.inflowFinancing += totals[col].inflowFinancing;
    grand.outflowFinancing += totals[col].outflowFinancing;
  }
  grand.netOperating = grand.inflowOperating - grand.outflowOperating;
  grand.netInvesting = grand.inflowInvesting - grand.outflowInvesting;
  grand.netFinancing = grand.inflowFinancing - grand.outflowFinancing;
  grand.netFlow = grand.netOperating + grand.netInvesting + grand.netFinancing;

  // Сортировка строк: сначала по разделу, потом по направлению, потом по убыванию суммы
  const sectionOrder: Record<string, number> = { operating: 1, investing: 2, financing: 3, transfer: 4 };
  const rows = Array.from(byArt.values()).sort((a, b) => {
    const sa = sectionOrder[a.section] || 99;
    const sb = sectionOrder[b.section] || 99;
    if (sa !== sb) return sa - sb;
    if (a.direction !== b.direction) return a.direction === 'inflow' ? -1 : 1;
    return b.total - a.total;
  });

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

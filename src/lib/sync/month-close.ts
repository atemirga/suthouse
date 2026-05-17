import { fetchAllOData } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { emptyKey, parseDate } from './utils';

// 1С создаёт 4-5 документов «ЗакрытиеМесяца» на каждый месяц — по одному на
// каждую стадию закрытия (РасчетПрямыхЗатрат, РаспределениеЗатрат,
// РасчетФактическойСебестоимости, РасчетФинансовогоРезультата). Все они
// имеют Date = последний день месяца 23:59:59.
// Агрегируем их в один MonthClose на yearMonth = первые 7 символов Date.
interface CloseRow {
  Ref_Key: string;
  Date: string;
  Number: string;
  Posted?: boolean;
  DeletionMark?: boolean;
  РасчетПрямыхЗатрат?: boolean;
  РаспределениеЗатрат?: boolean;
  РасчетФактическойСебестоимости?: boolean;
  РасчетФинансовогоРезультата?: boolean;
}

export async function syncMonthCloses() {
  const rows = await fetchAllOData<CloseRow>('Document_ЗакрытиеМесяца', {
    select:
      'Ref_Key,Date,Number,Posted,DeletionMark,РасчетПрямыхЗатрат,РаспределениеЗатрат,РасчетФактическойСебестоимости,РасчетФинансовогоРезультата',
  });

  // Группируем по месяцу
  const byMonth = new Map<
    string,
    {
      closedAt: Date;
      docRefs: string[];
      hasDirectCostCalc: boolean;
      hasCostDistribution: boolean;
      hasActualCost: boolean;
      hasFinancialResult: boolean;
    }
  >();

  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    if (r.Posted === false || r.DeletionMark === true) continue;
    const date = parseDate(r.Date);
    if (!date) continue;
    const yearMonth = r.Date.slice(0, 7); // "2026-04"
    let agg = byMonth.get(yearMonth);
    if (!agg) {
      agg = {
        closedAt: date,
        docRefs: [],
        hasDirectCostCalc: false,
        hasCostDistribution: false,
        hasActualCost: false,
        hasFinancialResult: false,
      };
      byMonth.set(yearMonth, agg);
    }
    agg.docRefs.push(r.Ref_Key);
    if (r.РасчетПрямыхЗатрат) agg.hasDirectCostCalc = true;
    if (r.РаспределениеЗатрат) agg.hasCostDistribution = true;
    if (r.РасчетФактическойСебестоимости) agg.hasActualCost = true;
    if (r.РасчетФинансовогоРезультата) agg.hasFinancialResult = true;
    if (date.getTime() > agg.closedAt.getTime()) agg.closedAt = date;
  }

  // Удаляем месяцы, которые больше не закрыты в 1С (например, отменили проведение)
  const knownMonths = Array.from(byMonth.keys());
  if (knownMonths.length > 0) {
    await prisma.monthClose.deleteMany({
      where: { yearMonth: { notIn: knownMonths } },
    });
  } else {
    await prisma.monthClose.deleteMany({});
  }

  for (const [yearMonth, agg] of byMonth.entries()) {
    await prisma.monthClose.upsert({
      where: { yearMonth },
      create: {
        yearMonth,
        closedAt: agg.closedAt,
        hasDirectCostCalc: agg.hasDirectCostCalc,
        hasCostDistribution: agg.hasCostDistribution,
        hasActualCost: agg.hasActualCost,
        hasFinancialResult: agg.hasFinancialResult,
        docRefs: JSON.stringify(agg.docRefs),
      },
      update: {
        closedAt: agg.closedAt,
        hasDirectCostCalc: agg.hasDirectCostCalc,
        hasCostDistribution: agg.hasCostDistribution,
        hasActualCost: agg.hasActualCost,
        hasFinancialResult: agg.hasFinancialResult,
        docRefs: JSON.stringify(agg.docRefs),
        syncedAt: new Date(),
      },
    });
  }

  return byMonth.size;
}

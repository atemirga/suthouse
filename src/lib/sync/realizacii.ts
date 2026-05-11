import { fetchAllOData, dateFilter, combineFilters, POSTED_FILTER } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { normalizeName, emptyKey, parseDate, num, syncSinceDate } from './utils';
import { buildCostPriceMap } from './zakupki';

interface RealizaciaRow {
  Ref_Key: string;
  Date: string;
  Number: string;
  СуммаДокумента?: number;
  Контрагент_Key?: string;
  Ответственный_Key?: string;
  ВидОперации?: string;
  Комментарий?: string;
  Posted?: boolean;
  DeletionMark?: boolean;
  Запасы?: Array<{
    Номенклатура_Key?: string;
    Количество?: number;
    Цена?: number;
    Сумма?: number;
    СуммаСкидкиНаценки?: number;
  }>;
}

const RESOURCE_ALIASES = ['Document_РасходнаяНакладная', 'Document_РеализацияТоваровУслуг'];

async function fetchRealizacii(filter: string): Promise<RealizaciaRow[]> {
  const select =
    'Ref_Key,Date,Number,СуммаДокумента,Контрагент_Key,Ответственный_Key,ВидОперации,Комментарий,Posted,DeletionMark,Запасы';
  let lastErr: any = null;
  for (const r of RESOURCE_ALIASES) {
    try {
      return await fetchAllOData<RealizaciaRow>(r, { filter, select });
    } catch (e: any) {
      lastErr = e;
      if (!/40[34]/.test(String(e.message))) throw e;
    }
  }
  throw lastErr;
}

export async function syncRealizacii(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  const rows = await fetchRealizacii(filter);

  const [konts, noms, users, costMap] = await Promise.all([
    prisma.kontragent.findMany({ select: { id: true, name: true } }),
    prisma.nomenclature.findMany({ select: { id: true, name: true } }),
    prisma.user1C.findMany({ select: { id: true, name: true } }),
    buildCostPriceMap(),
  ]);
  const kMap = new Map(konts.map((k) => [k.id, k.name]));
  const nMap = new Map(noms.map((n) => [n.id, n.name]));
  const uMap = new Map(users.map((u) => [u.id, u.name]));

  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const date = parseDate(r.Date);
    if (!date) continue;

    const kontragentId = r.Контрагент_Key && !emptyKey(r.Контрагент_Key) ? r.Контрагент_Key : null;
    const responsibleId = r.Ответственный_Key && !emptyKey(r.Ответственный_Key) ? r.Ответственный_Key : null;

    // costPrice здесь — приближение по последней закупочной цене. После
    // syncZakupki + syncRealizacii пайплайн вызывает recomputeFifoCosts,
    // который перезаписывает эти поля настоящим FIFO по полной истории партий.
    let totalCost = 0;
    const items = (r.Запасы || []).map((it) => {
      const nomenclatureId = it.Номенклатура_Key && !emptyKey(it.Номенклатура_Key) ? it.Номенклатура_Key : null;
      const quantity = num(it.Количество);
      const costPrice = nomenclatureId ? costMap.get(nomenclatureId) || 0 : 0;
      const costAmount = costPrice * quantity;
      totalCost += costAmount;
      return {
        nomenclatureId,
        nomenclatureName: nomenclatureId ? nMap.get(nomenclatureId) || `[${nomenclatureId.slice(0, 8)}]` : null,
        quantity,
        price: num(it.Цена),
        amount: num(it.Сумма),
        discount: num(it.СуммаСкидкиНаценки),
        costPrice,
        costAmount,
      };
    });

    await prisma.$transaction(async (tx) => {
      await tx.realizaciaItem.deleteMany({ where: { realizaciaId: r.Ref_Key } });
      await tx.realizacia.upsert({
        where: { id: r.Ref_Key },
        create: {
          id: r.Ref_Key,
          date,
          number: r.Number || '',
          kontragentId,
          kontragentName: kontragentId ? kMap.get(kontragentId) || `[${kontragentId.slice(0, 8)}]` : null,
          responsibleId,
          responsibleName: responsibleId ? uMap.get(responsibleId) || null : null,
          operationType: r.ВидОперации || null,
          totalAmount: num(r.СуммаДокумента),
          totalCost,
          comment: normalizeName(r.Комментарий) || null,
          posted: r.Posted !== false,
          items: { create: items },
        },
        update: {
          date,
          number: r.Number || '',
          kontragentId,
          kontragentName: kontragentId ? kMap.get(kontragentId) || `[${kontragentId.slice(0, 8)}]` : null,
          responsibleId,
          responsibleName: responsibleId ? uMap.get(responsibleId) || null : null,
          operationType: r.ВидОперации || null,
          totalAmount: num(r.СуммаДокумента),
          totalCost,
          comment: normalizeName(r.Комментарий) || null,
          posted: r.Posted !== false,
          syncedAt: new Date(),
          items: { create: items },
        },
      });
    });
    count++;
  }
  return count;
}

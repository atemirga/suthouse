import { fetchAllOData, dateFilter, combineFilters, POSTED_FILTER } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { normalizeName, emptyKey, parseDate, num, syncSinceDate } from './utils';

interface ZakupkaRow {
  Ref_Key: string;
  Date: string;
  Number: string;
  СуммаДокумента?: number;
  Контрагент_Key?: string;
  ВидОперации?: string;
  Posted?: boolean;
  DeletionMark?: boolean;
  Запасы?: Array<{
    Номенклатура_Key?: string;
    Количество?: number;
    Цена?: number;
    Сумма?: number;
  }>;
}

const RESOURCE_ALIASES = ['Document_ПриходнаяНакладная', 'Document_ПоступлениеТоваров'];

async function fetchZakupki(filter: string): Promise<ZakupkaRow[]> {
  // $select опущен — поля у УНФ KZ варьируются
  let lastErr: any = null;
  for (const r of RESOURCE_ALIASES) {
    try {
      return await fetchAllOData<ZakupkaRow>(r, { filter });
    } catch (e: any) {
      lastErr = e;
      if (!/40[34]/.test(String(e.message))) throw e;
    }
  }
  throw lastErr;
}

export async function syncZakupki(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  const rows = await fetchZakupki(filter);

  const [konts, noms] = await Promise.all([
    prisma.kontragent.findMany({ select: { id: true, name: true } }),
    prisma.nomenclature.findMany({ select: { id: true, name: true } }),
  ]);
  const kMap = new Map(konts.map((k) => [k.id, k.name]));
  const nMap = new Map(noms.map((n) => [n.id, n.name]));

  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const date = parseDate(r.Date);
    if (!date) continue;
    const kontragentId = r.Контрагент_Key && !emptyKey(r.Контрагент_Key) ? r.Контрагент_Key : null;
    // Возвраты от покупателей — не настоящие закупки. Их цены не должны влиять
    // на карту последних закупочных цен (см. buildCostPriceMap).
    const isReturn = r.ВидОперации === 'ВозвратОтПокупателя';

    const items = (r.Запасы || []).map((it) => {
      const nomenclatureId = it.Номенклатура_Key && !emptyKey(it.Номенклатура_Key) ? it.Номенклатура_Key : null;
      return {
        nomenclatureId,
        nomenclatureName: nomenclatureId ? nMap.get(nomenclatureId) || `[${nomenclatureId.slice(0, 8)}]` : null,
        quantity: num(it.Количество),
        price: num(it.Цена),
        amount: num(it.Сумма),
      };
    });

    await prisma.$transaction(async (tx) => {
      await tx.zakupkaItem.deleteMany({ where: { zakupkaId: r.Ref_Key } });
      await tx.zakupka.upsert({
        where: { id: r.Ref_Key },
        create: {
          id: r.Ref_Key,
          date,
          number: r.Number || '',
          kontragentId,
          kontragentName: kontragentId ? kMap.get(kontragentId) || `[${kontragentId.slice(0, 8)}]` : null,
          totalAmount: num(r.СуммаДокумента),
          operationType: r.ВидОперации || null,
          isReturn,
          posted: r.Posted !== false,
          items: { create: items },
        },
        update: {
          date,
          number: r.Number || '',
          kontragentId,
          kontragentName: kontragentId ? kMap.get(kontragentId) || `[${kontragentId.slice(0, 8)}]` : null,
          totalAmount: num(r.СуммаДокумента),
          operationType: r.ВидОперации || null,
          isReturn,
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

// Глобальный словарь {nomenclatureId → последняя закупочная цена}
// Используется для расчёта себестоимости реализаций.
// ВАЖНО: возвраты от покупателей (isReturn=true) исключаются — их цена это цена
// продажи, а не закупки, и она бы исказила себестоимость.
export async function buildCostPriceMap(): Promise<Map<string, number>> {
  const items = await prisma.zakupkaItem.findMany({
    where: {
      nomenclatureId: { not: null },
      price: { gt: 0 },
      zakupka: { isReturn: false },
    },
    select: { nomenclatureId: true, price: true, zakupka: { select: { date: true } } },
    orderBy: { zakupka: { date: 'asc' } },
  });
  const map = new Map<string, number>();
  for (const it of items) {
    if (it.nomenclatureId) map.set(it.nomenclatureId, it.price);
  }
  return map;
}

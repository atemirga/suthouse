import { fetchAllOData, dateFilter, combineFilters, POSTED_FILTER } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { normalizeName, emptyKey, parseDate, num, syncSinceDate } from './utils';

interface InventoryRow {
  Ref_Key: string;
  Date: string;
  Number: string;
  СуммаДокумента?: number;
  Ответственный_Key?: string;
  Комментарий?: string;
  Posted?: boolean;
  DeletionMark?: boolean;
  Запасы?: Array<{
    Номенклатура_Key?: string;
    Количество?: number;
    Сумма?: number;
  }>;
}

// $select опущен — состав полей варьируется между конфигурациями УНФ.

export async function syncWriteOffs(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  let rows: InventoryRow[] = [];
  try {
    rows = await fetchAllOData<InventoryRow>('Document_СписаниеЗапасов', { filter });
  } catch (e: any) {
    if (/40[34]/.test(String(e.message))) return 0;
    throw e;
  }

  const noms = await prisma.nomenclature.findMany({ select: { id: true, name: true } });
  const users = await prisma.user1C.findMany({ select: { id: true, name: true } });
  const nMap = new Map(noms.map((n) => [n.id, n.name]));
  const uMap = new Map(users.map((u) => [u.id, u.name]));

  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const date = parseDate(r.Date);
    if (!date) continue;
    const items = (r.Запасы || []).map((it) => {
      const nomenclatureId = it.Номенклатура_Key && !emptyKey(it.Номенклатура_Key) ? it.Номенклатура_Key : null;
      return {
        nomenclatureId,
        nomenclatureName: nomenclatureId ? nMap.get(nomenclatureId) || null : null,
        quantity: num(it.Количество),
        amount: num(it.Сумма),
      };
    });
    const responsibleName = r.Ответственный_Key && !emptyKey(r.Ответственный_Key) ? uMap.get(r.Ответственный_Key) || null : null;

    await prisma.$transaction(async (tx) => {
      await tx.writeOffItem.deleteMany({ where: { writeOffId: r.Ref_Key } });
      await tx.writeOff.upsert({
        where: { id: r.Ref_Key },
        create: {
          id: r.Ref_Key,
          date,
          number: r.Number || '',
          totalAmount: num(r.СуммаДокумента),
          responsibleName,
          comment: normalizeName(r.Комментарий) || null,
          posted: r.Posted !== false,
          items: { create: items },
        },
        update: {
          date,
          number: r.Number || '',
          totalAmount: num(r.СуммаДокумента),
          responsibleName,
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

export async function syncCapitalizations(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  let rows: InventoryRow[] = [];
  try {
    rows = await fetchAllOData<InventoryRow>('Document_ОприходованиеЗапасов', { filter });
  } catch (e: any) {
    if (/40[34]/.test(String(e.message))) return 0;
    throw e;
  }

  const noms = await prisma.nomenclature.findMany({ select: { id: true, name: true } });
  const users = await prisma.user1C.findMany({ select: { id: true, name: true } });
  const nMap = new Map(noms.map((n) => [n.id, n.name]));
  const uMap = new Map(users.map((u) => [u.id, u.name]));

  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const date = parseDate(r.Date);
    if (!date) continue;
    const items = (r.Запасы || []).map((it) => {
      const nomenclatureId = it.Номенклатура_Key && !emptyKey(it.Номенклатура_Key) ? it.Номенклатура_Key : null;
      return {
        nomenclatureId,
        nomenclatureName: nomenclatureId ? nMap.get(nomenclatureId) || null : null,
        quantity: num(it.Количество),
        amount: num(it.Сумма),
      };
    });
    const responsibleName = r.Ответственный_Key && !emptyKey(r.Ответственный_Key) ? uMap.get(r.Ответственный_Key) || null : null;

    await prisma.$transaction(async (tx) => {
      await tx.capitalizationItem.deleteMany({ where: { capitalizationId: r.Ref_Key } });
      await tx.capitalization.upsert({
        where: { id: r.Ref_Key },
        create: {
          id: r.Ref_Key,
          date,
          number: r.Number || '',
          totalAmount: num(r.СуммаДокумента),
          responsibleName,
          comment: normalizeName(r.Комментарий) || null,
          posted: r.Posted !== false,
          items: { create: items },
        },
        update: {
          date,
          number: r.Number || '',
          totalAmount: num(r.СуммаДокумента),
          responsibleName,
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

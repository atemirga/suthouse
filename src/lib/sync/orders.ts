import { fetchAllOData, dateFilter, combineFilters, POSTED_FILTER } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { normalizeName, emptyKey, parseDate, num, syncSinceDate } from './utils';

interface OrderRow {
  Ref_Key: string;
  Date: string;
  Number: string;
  СуммаДокумента?: number;
  СуммаОплачено?: number; // некоторые конфигурации
  Оплачено?: number; // могут быть и булево, и число — храним как число
  Контрагент_Key?: string;
  Ответственный_Key?: string;
  Курьер_Key?: string; // в этой 1С используется как «упаковщик/сборщик»
  Статус?: string;
  ДатаОтгрузки?: string;
  Комментарий?: string;
  Posted?: boolean;
  DeletionMark?: boolean;
}

export async function syncOrders(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  // Без $select — 1С возвращает все поля, мы берём только нужные.
  // Делается так потому, что набор полей ЗаказаПокупателя в УНФ варьируется
  // от конфигурации (Оплачено, ДатаОтгрузки могут отсутствовать).
  const rows = await fetchAllOData<OrderRow>('Document_ЗаказПокупателя', { filter });

  const [konts, users, employees] = await Promise.all([
    prisma.kontragent.findMany({ select: { id: true, name: true } }),
    prisma.user1C.findMany({ select: { id: true, name: true } }),
    prisma.employee.findMany({ select: { id: true, name: true } }),
  ]);
  const kMap = new Map(konts.map((k) => [k.id, k.name]));
  // «Ответственный» в Заказе ссылается на Catalog_Сотрудники (Employee), а не Catalog_Пользователи.
  const uMap = new Map(users.map((u) => [u.id, u.name]));
  const eMap = new Map(employees.map((e) => [e.id, e.name]));
  const resolveResp = (id: string | null) => (id ? (eMap.get(id) || uMap.get(id) || null) : null);

  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const date = parseDate(r.Date);
    if (!date) continue;
    const kontragentId = r.Контрагент_Key && !emptyKey(r.Контрагент_Key) ? r.Контрагент_Key : null;
    const responsibleId = r.Ответственный_Key && !emptyKey(r.Ответственный_Key) ? r.Ответственный_Key : null;
    const courierId = r.Курьер_Key && !emptyKey(r.Курьер_Key) ? r.Курьер_Key : null;

    // В УНФ 1.6 KZ поля Статус нет, "статус" — это ВидОперации (например "ЗаказНаПродажу").
    const status = r.Статус || (r as any).ВидОперации || null;

    await prisma.orderBuyer.upsert({
      where: { id: r.Ref_Key },
      create: {
        id: r.Ref_Key,
        date,
        number: r.Number || '',
        kontragentId,
        kontragentName: kontragentId ? kMap.get(kontragentId) || `[${kontragentId.slice(0, 8)}]` : null,
        responsibleId,
        responsibleName: resolveResp(responsibleId),
        courierId,
        courierName: resolveResp(courierId),
        totalAmount: num(r.СуммаДокумента),
        paidAmount: num(r.СуммаОплачено) || num(r.Оплачено),
        status,
        shipmentDate: parseDate(r.ДатаОтгрузки),
        comment: normalizeName(r.Комментарий) || null,
        posted: r.Posted !== false,
      },
      update: {
        date,
        number: r.Number || '',
        kontragentId,
        kontragentName: kontragentId ? kMap.get(kontragentId) || `[${kontragentId.slice(0, 8)}]` : null,
        responsibleId,
        responsibleName: resolveResp(responsibleId),
        courierId,
        courierName: resolveResp(courierId),
        totalAmount: num(r.СуммаДокумента),
        paidAmount: num(r.СуммаОплачено) || num(r.Оплачено),
        status,
        shipmentDate: parseDate(r.ДатаОтгрузки),
        comment: normalizeName(r.Комментарий) || null,
        posted: r.Posted !== false,
        syncedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

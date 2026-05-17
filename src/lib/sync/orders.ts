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
  Курьер_Key?: string;
  Статус?: string;
  ДатаОтгрузки?: string;
  Комментарий?: string;
  Posted?: boolean;
  DeletionMark?: boolean;
}

interface AddPropRow {
  Ref_Key: string;        // GUID родительского ЗаказаПокупателя
  Свойство_Key: string;
  Значение: string;       // GUID сотрудника (Catalog_Сотрудники)
  Значение_Type?: string;
}

// GUID доп.свойства «Упаковщик» в ChartOfCharacteristicTypes_ДополнительныеРеквизитыИСведения.
const PACKER_PROP_GUID = 'd64eea4f-f086-11f0-ae70-c81f66edd58d';

export async function syncOrders(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  // Без $select — 1С возвращает все поля, мы берём только нужные.
  // Делается так потому, что набор полей ЗаказаПокупателя в УНФ варьируется
  // от конфигурации (Оплачено, ДатаОтгрузки могут отсутствовать).
  const rows = await fetchAllOData<OrderRow>('Document_ЗаказПокупателя', { filter });

  // Параллельно подтягиваем доп.реквизиты — там лежит «Упаковщик».
  // Фильтруем по Свойство_Key, дата не нужна (Ref_Key совпадёт с ЗаказомПокупателя).
  const propsFilter = `Свойство_Key eq guid'${PACKER_PROP_GUID}'`;
  const propRows = await fetchAllOData<AddPropRow>(
    'Document_ЗаказПокупателя_ДополнительныеРеквизиты',
    { filter: propsFilter },
  );
  const packerByOrder = new Map<string, string>();
  for (const p of propRows) {
    if (emptyKey(p.Ref_Key) || emptyKey(p.Значение)) continue;
    packerByOrder.set(p.Ref_Key, p.Значение);
  }

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
    const packerId = packerByOrder.get(r.Ref_Key) || null;

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
        packerId,
        packerName: resolveResp(packerId),
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
        packerId,
        packerName: resolveResp(packerId),
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

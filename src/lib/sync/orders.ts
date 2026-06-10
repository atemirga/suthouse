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
  // GUID из Catalog_СостоянияЗаказовПокупателей. В этой 1С: «Завершен»,
  // «В работе», «ОТК Менеджер», «ОТК Зав Склад», «Проблема» и т.д.
  // OData отдаёт без суффикса _Key.
  СостояниеЗаказа?: string;
  ДатаОтгрузки?: string;
  Комментарий?: string;
  Posted?: boolean;
  DeletionMark?: boolean;
  // Табличная часть товаров. В УНФ KZ это «Запасы», но на всякий случай
  // поддерживаем и «Товары» — встречается в других сборках.
  Запасы?: Array<OrderItemRow>;
  Товары?: Array<OrderItemRow>;
}

interface OrderStateRow {
  Ref_Key: string;
  Description: string;
}

interface OrderItemRow {
  Номенклатура_Key?: string;
  Количество?: number;
  Цена?: number;
  Сумма?: number;
}

// Реальное представление строки табличной части из 1С.
// 1С УНФ KZ не поддерживает $expand на ЗаказПокупателя (501 Not Implemented),
// поэтому строки тянем отдельной сущностью Document_ЗаказПокупателя_Запасы,
// а у неё поле ссылки на номенклатуру называется без `_Key` суффикса.
interface RawOrderItemRow {
  Ref_Key: string;
  LineNumber?: string;
  Номенклатура?: string;
  Количество?: number;
  Цена?: number;
  Сумма?: number;
}

interface AddPropRow {
  Ref_Key: string;        // GUID родительского ЗаказаПокупателя
  Свойство_Key: string;
  Значение: string;       // GUID сотрудника (Catalog_Сотрудники)
  Значение_Type?: string;
}

// GUID доп.свойства «Упаковщик» в ChartOfCharacteristicTypes_ДополнительныеРеквизитыИСведения.
const PACKER_PROP_GUID = 'd64eea4f-f086-11f0-ae70-c81f66edd58d';

// Чанк размер для подтягивания строк по Ref_Key через `or`. 50 — безопасный
// потолок по длине URL для 1С OData.
const ORDER_ITEMS_CHUNK = 50;

async function fetchOrderItems(orderIds: string[]): Promise<Map<string, RawOrderItemRow[]>> {
  const grouped = new Map<string, RawOrderItemRow[]>();
  if (orderIds.length === 0) return grouped;

  // Чанкованный фильтр почти всегда быстрее «fetch all»: в 1С табличная
  // часть Document_ЗаказПокупателя_Запасы имеет ~94k строк (порядка 100 страниц
  // по 1000), а 30-дневный инкремент = ~30-50 OData-запросов по 50 заказов.
  // Fetch-all включаем только когда заказов реально много (полный/первый синк).
  let items: RawOrderItemRow[] = [];
  if (orderIds.length > 3000) {
    items = await fetchAllOData<RawOrderItemRow>('Document_ЗаказПокупателя_Запасы');
  } else {
    for (let i = 0; i < orderIds.length; i += ORDER_ITEMS_CHUNK) {
      const chunk = orderIds.slice(i, i + ORDER_ITEMS_CHUNK);
      const filter = chunk.map((id) => `Ref_Key eq guid'${id}'`).join(' or ');
      const part = await fetchAllOData<RawOrderItemRow>(
        'Document_ЗаказПокупателя_Запасы',
        { filter },
      );
      items.push(...part);
    }
  }

  const wanted = new Set(orderIds);
  for (const it of items) {
    if (!it.Ref_Key || !wanted.has(it.Ref_Key)) continue;
    let arr = grouped.get(it.Ref_Key);
    if (!arr) {
      arr = [];
      grouped.set(it.Ref_Key, arr);
    }
    arr.push(it);
  }
  // Сохраняем порядок строк по LineNumber, как в документе.
  for (const arr of grouped.values()) {
    arr.sort((a, b) => Number(a.LineNumber || 0) - Number(b.LineNumber || 0));
  }
  return grouped;
}

export async function syncOrders(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  // Без $select — 1С возвращает все поля, мы берём только нужные.
  // Делается так потому, что набор полей ЗаказаПокупателя в УНФ варьируется
  // от конфигурации (Оплачено, ДатаОтгрузки могут отсутствовать).
  const rows = await fetchAllOData<OrderRow>('Document_ЗаказПокупателя', { filter });

  // Подтягиваем строки табличной части. $expand 1С УНФ не поддерживает,
  // поэтому идём через отдельный entity set.
  const orderIds = rows.map((r) => r.Ref_Key).filter((id): id is string => !emptyKey(id));
  const itemsByOrder = await fetchOrderItems(orderIds);

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

  // Каталог состояний заказа — маленький (10 значений), кэшируем имена.
  const stateRows = await fetchAllOData<OrderStateRow>(
    'Catalog_СостоянияЗаказовПокупателей',
    { single: true },
  );
  const stateNames = new Map<string, string>(
    stateRows.map((s) => [s.Ref_Key, s.Description]),
  );

  const [konts, noms, users, employees] = await Promise.all([
    prisma.kontragent.findMany({ select: { id: true, name: true } }),
    prisma.nomenclature.findMany({ select: { id: true, name: true } }),
    prisma.user1C.findMany({ select: { id: true, name: true } }),
    prisma.employee.findMany({ select: { id: true, name: true } }),
  ]);
  const kMap = new Map(konts.map((k) => [k.id, k.name]));
  const nMap = new Map(noms.map((n) => [n.id, n.name]));
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

    const stateId = r.СостояниеЗаказа && !emptyKey(r.СостояниеЗаказа) ? r.СостояниеЗаказа : null;
    const stateName = stateId ? stateNames.get(stateId) || null : null;

    // Строки берём из подтянутой отдельно табличной части. Поле ссылки
    // у entity Document_ЗаказПокупателя_Запасы называется `Номенклатура`
    // (без `_Key`) — это уже сам Ref. Запасы/Товары в r теперь игнорируем
    // (1С их не возвращает в хедере без $expand).
    const rawItems = itemsByOrder.get(r.Ref_Key) || [];
    const items = rawItems.map((it) => {
      const nomenclatureId = it.Номенклатура && !emptyKey(it.Номенклатура) ? it.Номенклатура : null;
      return {
        nomenclatureId,
        nomenclatureName: nomenclatureId ? nMap.get(nomenclatureId) || `[${nomenclatureId.slice(0, 8)}]` : null,
        quantity: num(it.Количество),
        price: num(it.Цена),
        amount: num(it.Сумма),
      };
    });

    const baseFields = {
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
      stateId,
      stateName,
      shipmentDate: parseDate(r.ДатаОтгрузки),
      comment: normalizeName(r.Комментарий) || null,
      posted: r.Posted !== false,
    };

    await prisma.$transaction(async (tx) => {
      await tx.orderBuyerItem.deleteMany({ where: { orderBuyerId: r.Ref_Key } });
      await tx.orderBuyer.upsert({
        where: { id: r.Ref_Key },
        create: { id: r.Ref_Key, ...baseFields, items: { create: items } },
        update: { ...baseFields, syncedAt: new Date(), items: { create: items } },
      });
    });
    count++;
  }
  return count;
}

import { fetchAllOData } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { normalizeName, emptyKey } from './utils';

// Автомаппинг статей ДДС на категории ОПиУ по ключевым словам в названии.
// Применяется при создании новой статьи И при пересинке, если у статьи opiuCategory ещё пуста.
// Порядок важен: более специфичные правила идут раньше общих.
export const AUTO_MAPPING: Array<{ rx: RegExp; opiu: string; section: string }> = [
  // Выручка / поступления от покупателей
  { rx: /оплат[а-я]*\s+от\s+покуп|поступлен[а-я]*\s+от\s+покуп|выручк|реализ/i, opiu: 'revenue', section: 'operating' },
  // Возвраты денег покупателям
  { rx: /возврат[а-я]*\s+(денеж|средств|покупател|клиент)/i, opiu: 'revenue', section: 'operating' }, // — будет скорректировано через знак
  // Себестоимость / поставщики
  { rx: /оплат[а-я]*\s+поставщ|поставщ|закуп|сырь[ёе]|материал(?!ьн)/i, opiu: 'cogs', section: 'operating' },
  // ФОТ / зарплата (включая мотивационные, премии)
  { rx: /заработн[а-я]*\s*плат|зарплат|\bфот\b|оплат[а-я]*\s*труд|преми|оклад|мотивац|бонус.*сотрудн|материальн[а-я]*\s*помощ/i, opiu: 'payroll', section: 'operating' },
  // Аренда
  { rx: /аренд|субаренд|съем|рент/i, opiu: 'rent', section: 'operating' },
  // Маркетинг
  { rx: /реклам|маркетинг|\bsmm\b|таргет|\bseo\b|продвижен|промоушен|pr-?активност/i, opiu: 'marketing', section: 'operating' },
  // Налоги
  { rx: /\bналог|\bипн\b|\bкпн\b|\bндс\b|соцн[а-я]*\s*налог|пенсион|\bосмс\b|обязательн[а-я]*\s*мед|\bсо\b/i, opiu: 'taxes', section: 'operating' },
  // Проценты по кредитам и комиссии банка
  { rx: /процент|\bкредит|\bзайм|банковск[а-я]*\s*комисс|комисси[а-я]*\s*банк|комисси[а-я]*\s*эквайринг|эквайринг|комиссия\s+pos/i, opiu: 'interest', section: 'operating' },
  // Логистика / таможня / транспорт / ГСМ
  { rx: /логистик|доставк|перевозк|транспорт|таможен|гсм|топлив|бензин|солярк|дизель|парковк|автомобил|курьер/i, opiu: 'logistics', section: 'operating' },
  // Дивиденды (выплата собственникам — финансовая деятельность)
  { rx: /дивиденд|выплат[а-я]*\s*собствен|вывод[а-я]*\s*приб|распределен[а-я]*\s*приб/i, opiu: 'financing_out', section: 'financing' },
  // Благотворительность / медресе / закят
  { rx: /благотвор|пожертв|медресе|закят|садака|саадака/i, opiu: 'other_expense', section: 'operating' },
  // CAPEX (основные средства покупка) — раньше «продажа ОС», иначе перепутает
  { rx: /покупк[а-я]*\s*ос|приобретен[а-я]*\s*ос|капитал[а-я]*\s*вложен/i, opiu: 'capex', section: 'investing' },
  // Продажа ОС — это инвестиционный приход
  { rx: /продаж[а-я]*\s*ос|реализ[а-я]*\s*основн|выбыт[а-я]*\s*основн/i, opiu: 'other_income', section: 'investing' },
  // Ремонт / обслуживание ОС — операционные затраты на ОС
  { rx: /ремонт|обслуживан|техоблуж|содержан[а-я]*\s*оборудован/i, opiu: 'admin', section: 'operating' },
  // Связь / интернет / IT
  { rx: /связ\b|связи|интернет|телефон|хост|домен|подписк|сервер|облак[а-я]*\s*сервис|\bit\b|айти|software|по\s+лиценз/i, opiu: 'admin', section: 'operating' },
  // Коммуналка
  { rx: /коммунал|электр[а-я]*\s*энерг|водоснабж|газоснабж|отоплен/i, opiu: 'admin', section: 'operating' },
  // Канцелярия / расходники / офисные расходы
  { rx: /канцеляр|хозтов|уборк|расходн[а-я]*\s*материал|инвентар|офисн[а-я]*\s*расход|расход[а-я]*\s*склад|кухн[а-я]*\s*расход/i, opiu: 'admin', section: 'operating' },
  // Консультационные / юридические / аудиторские / профуслуги
  { rx: /консультацион|юридическ|аудитор|нотариальн|проф[а-я]*\s*услуг|услуг[а-я]*\s*юрист|бухгалтерск[а-я]*\s*услуг/i, opiu: 'admin', section: 'operating' },
  // Обучение персонала
  { rx: /обучен[а-я]*\s*персонал|курсы|тренинг|повышен[а-я]*\s*квалиф|семинар|конференц/i, opiu: 'admin', section: 'operating' },
  // Командировочные / представительские
  { rx: /командировочн|командировк|представительск/i, opiu: 'admin', section: 'operating' },
  // Корпоративы / тимбилдинг
  { rx: /корпоратив|тимбилдинг|teambuilding|корпорат[а-я]*\s*мероприят|новогодн|праздни[а-я]*\s*расход/i, opiu: 'admin', section: 'operating' },
  // Курсовые разницы
  { rx: /курсов[а-я]*\s*разниц|разниц[а-я]*\s*курс/i, opiu: 'other_expense', section: 'operating' },
  // Перемещения
  { rx: /перемещен|внутрифирм|трансфер|перевод[а-я]*\s+на\s+другой/i, opiu: 'transfer', section: 'transfer' },
  // Получение/возврат займов и кредитов — финансовая деятельность
  { rx: /получен[а-я]*\s*кредит|выдач[а-я]*\s*займ|погашен[а-я]*\s*кредит|погашен[а-я]*\s*займ|возврат[а-я]*\s*кредит|возврат[а-я]*\s*займ/i, opiu: 'financing_out', section: 'financing' },
  // "Прочее" — в самый конец, иначе перебивает специфичные
  { rx: /проч[а-я]*\s*расход|проч[а-я]*\s*выплат|неклассифиц|разное|прочее/i, opiu: 'other_expense', section: 'operating' },
];

export function autoMapArticle(name: string): { opiu: string | null; section: string } {
  for (const m of AUTO_MAPPING) {
    if (m.rx.test(name)) return { opiu: m.opiu, section: m.section };
  }
  return { opiu: null, section: 'operating' };
}

// alias для совместимости со старым кодом
const autoMap = autoMapArticle;

interface CatRow {
  Ref_Key: string;
  Description: string;
  Parent_Key?: string;
  IsFolder?: boolean;
}

export async function syncAttractionSources() {
  const rows = await fetchAllOData<CatRow>('Catalog_ИсточникиПривлеченияПокупателей', {
    select: 'Ref_Key,Description',
  });
  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    await prisma.attractionSource.upsert({
      where: { id: r.Ref_Key },
      create: { id: r.Ref_Key, name: normalizeName(r.Description) || '[Источник]' },
      update: { name: normalizeName(r.Description) || '[Источник]', syncedAt: new Date() },
    });
    count++;
  }
  return count;
}

export async function syncKontragenty() {
  const rows = await fetchAllOData<CatRow & { Ответственный_Key?: string; ИсточникПривлеченияПокупателя_Key?: string }>(
    'Catalog_Контрагенты',
    { select: 'Ref_Key,Description,Parent_Key,IsFolder,Ответственный_Key,ИсточникПривлеченияПокупателя_Key' },
  );
  // Резолвим ответственного через Catalog_Пользователи (загружено отдельно)
  const users = await prisma.user1C.findMany({ select: { id: true, name: true } });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const attractionSourceId = !emptyKey(r.ИсточникПривлеченияПокупателя_Key)
      ? r.ИсточникПривлеченияПокупателя_Key!
      : null;
    await prisma.kontragent.upsert({
      where: { id: r.Ref_Key },
      create: {
        id: r.Ref_Key,
        name: normalizeName(r.Description) || '[без названия]',
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
        isFolder: !!r.IsFolder,
        responsible: emptyKey(r.Ответственный_Key) ? null : userMap.get(r.Ответственный_Key!) || null,
        attractionSourceId,
      },
      update: {
        name: normalizeName(r.Description) || '[без названия]',
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
        isFolder: !!r.IsFolder,
        attractionSourceId,
        responsible: emptyKey(r.Ответственный_Key) ? null : userMap.get(r.Ответственный_Key!) || null,
        syncedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

export async function syncDdsArticles() {
  const rows = await fetchAllOData<CatRow>('Catalog_СтатьиДвиженияДенежныхСредств', {
    select: 'Ref_Key,Description,Parent_Key,IsFolder',
  });
  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const name = normalizeName(r.Description) || '[без названия]';
    const existing = await prisma.ddsArticle.findUnique({ where: { id: r.Ref_Key } });
    const auto = autoMap(name);

    await prisma.ddsArticle.upsert({
      where: { id: r.Ref_Key },
      create: {
        id: r.Ref_Key,
        name,
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
        isFolder: !!r.IsFolder,
        opiuCategory: r.IsFolder ? null : auto.opiu,
        ddsSection: auto.section,
      },
      update: {
        name,
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
        isFolder: !!r.IsFolder,
        // Не перезаписываем уже выставленные пользователем категории.
        // Но если ранее категория не была проставлена (NULL), пробуем автомаппинг — вдруг
        // регекс улучшили или название статьи изменилось.
        ...(existing?.opiuCategory ? {} : { opiuCategory: r.IsFolder ? null : auto.opiu }),
        ddsSection: existing?.ddsSection || auto.section,
        syncedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

// Catalog_КатегорииНоменклатуры — управленческие категории товаров
// (Курт, Ірімшік, Май и т.п.). Это правильный источник «По категориям» в отчётах.
export async function syncNomenclatureCategories() {
  const rows = await fetchAllOData<CatRow>('Catalog_КатегорииНоменклатуры', {
    select: 'Ref_Key,Description,Parent_Key',
  });
  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    await prisma.nomenclatureCategory.upsert({
      where: { id: r.Ref_Key },
      create: {
        id: r.Ref_Key,
        name: normalizeName(r.Description) || '[без названия]',
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
      },
      update: {
        name: normalizeName(r.Description) || '[без названия]',
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
        syncedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

export async function syncNomenclature() {
  const rows = await fetchAllOData<CatRow & { КатегорияНоменклатуры_Key?: string }>(
    'Catalog_Номенклатура',
    { select: 'Ref_Key,Description,Parent_Key,IsFolder,КатегорияНоменклатуры_Key' },
  );
  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const categoryId = !emptyKey(r.КатегорияНоменклатуры_Key) ? r.КатегорияНоменклатуры_Key! : null;
    await prisma.nomenclature.upsert({
      where: { id: r.Ref_Key },
      create: {
        id: r.Ref_Key,
        name: normalizeName(r.Description) || '[без названия]',
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
        isFolder: !!r.IsFolder,
        categoryId,
      },
      update: {
        name: normalizeName(r.Description) || '[без названия]',
        parentId: emptyKey(r.Parent_Key) ? null : r.Parent_Key,
        isFolder: !!r.IsFolder,
        categoryId,
        syncedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

export async function syncKassy() {
  const rows = await fetchAllOData<CatRow>('Catalog_Кассы', { select: 'Ref_Key,Description' });
  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    await prisma.kassa.upsert({
      where: { id: r.Ref_Key },
      create: { id: r.Ref_Key, name: normalizeName(r.Description) || '[Касса]' },
      update: { name: normalizeName(r.Description) || '[Касса]', syncedAt: new Date() },
    });
    count++;
  }
  return count;
}

export async function syncBankAccounts() {
  const rows = await fetchAllOData<CatRow>('Catalog_БанковскиеСчета', {
    select: 'Ref_Key,Description',
  });
  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    await prisma.bankAccount.upsert({
      where: { id: r.Ref_Key },
      create: { id: r.Ref_Key, name: normalizeName(r.Description) || '[Счёт]' },
      update: { name: normalizeName(r.Description) || '[Счёт]', syncedAt: new Date() },
    });
    count++;
  }
  return count;
}

export async function syncUsers() {
  const rows = await fetchAllOData<CatRow>('Catalog_Пользователи', {
    select: 'Ref_Key,Description',
  });
  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    await prisma.user1C.upsert({
      where: { id: r.Ref_Key },
      create: { id: r.Ref_Key, name: normalizeName(r.Description) || '[Пользователь]' },
      update: { name: normalizeName(r.Description) || '[Пользователь]', syncedAt: new Date() },
    });
    count++;
  }
  return count;
}

// Catalog_Сотрудники — реальные менеджеры (Жанис, Акат, Нурхуда…), на которых
// ссылается «Ответственный» в Заказах и Реализациях. НЕ путать с Catalog_Пользователи
// (Админ, Salamat, SSL — системные пользователи).
//
// ДОПОЛНИТЕЛЬНО мы тянем сюда же Catalog_ФизическиеЛица — на физлица ссылаются
// поля типа «Курьер_Key» в заказе. ID физлица и сотрудника — разные namespace,
// поэтому в Employee они мирно сосуществуют без конфликтов.
export async function syncEmployees() {
  const [employees, physicals] = await Promise.all([
    fetchAllOData<CatRow>('Catalog_Сотрудники', {
      select: 'Ref_Key,Description,Parent_Key,IsFolder',
    }),
    fetchAllOData<CatRow>('Catalog_ФизическиеЛица', {
      select: 'Ref_Key,Description,Parent_Key,IsFolder',
    }),
  ]);

  let count = 0;
  for (const r of [...employees, ...physicals]) {
    if (emptyKey(r.Ref_Key)) continue;
    const parentId = r.Parent_Key && !emptyKey(r.Parent_Key) ? r.Parent_Key : null;
    await prisma.employee.upsert({
      where: { id: r.Ref_Key },
      create: {
        id: r.Ref_Key,
        name: normalizeName(r.Description) || '[Сотрудник]',
        parentId,
        isFolder: !!r.IsFolder,
      },
      update: {
        name: normalizeName(r.Description) || '[Сотрудник]',
        parentId,
        isFolder: !!r.IsFolder,
        syncedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

export async function syncAllCatalogs() {
  // Пользователи, сотрудники и источники привлечения нужны до контрагентов и документов.
  const [users, employees, sources] = await Promise.all([
    syncUsers(),
    syncEmployees(),
    syncAttractionSources(),
  ]);
  // Категории номенклатуры нужны до самой номенклатуры (для resolve КатегорияНоменклатуры_Key).
  const nomCategories = await syncNomenclatureCategories();
  const [kontragenty, articles, nom, kassy, banks] = await Promise.all([
    syncKontragenty(),
    syncDdsArticles(),
    syncNomenclature(),
    syncKassy(),
    syncBankAccounts(),
  ]);
  return { users, employees, sources, kontragenty, articles, nomenclature: nom, nomCategories, kassy, banks };
}

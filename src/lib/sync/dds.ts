import { fetchAllOData, dateFilter, combineFilters, POSTED_FILTER } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { normalizeName, emptyKey, parseDate, num, syncSinceDate, computeStaleIds } from './utils';

interface DdsRow {
  Ref_Key: string;
  Date: string;
  Number: string;
  // Сумма может быть в одном из этих полей
  СуммаДокумента?: number;
  Сумма?: number;
  СуммаОперации?: number;
  СуммаКомиссииДокумента?: number;
  Контрагент_Key?: string;
  ВидОперации?: string;
  // Статья ДДС: в УНФ 1.6 KZ это Статья_Key (в шапке), в других — СтатьяДДС_Key
  СтатьяДДС_Key?: string;
  Статья_Key?: string;
  Касса_Key?: string;
  КассаПолучатель_Key?: string;
  СчетОрганизации_Key?: string;
  БанковскийСчет_Key?: string;  // в УНФ KZ называется так
  БанковскийСчетПолучатель_Key?: string; // для ПеремещениеДС bank-side
  // Для ПереводНаДругойСчет — это наш же счёт-получатель
  // (Owner=Catalog_Организации, проверено через 1С). Имя поля вводит в
  // заблуждение — это не контрагентский счёт.
  СчетКонтрагента_Key?: string;
  ТипДенежныхСредств?: string;             // Наличные | Безналичные (источник)
  ТипДенежныхСредствПолучатель?: string;   // Наличные | Безналичные (получатель)
  Комментарий?: string;
  НазначениеПлатежа?: string;
  ПериодРегистрации?: string; // для ЗП-выплат — месяц начисления (accrual)
  Выдать?: string;            // имя сотрудника-получателя в ЗП-выплатах
  Posted?: boolean;
  DeletionMark?: boolean;
  РасшифровкаПлатежа?: Array<{
    Сумма?: number;
    СуммаПлатежа?: number;
    СтатьяДДС_Key?: string;
    Статья_Key?: string;
    Контрагент_Key?: string;
  }>;
}

// Внутренние перемещения денежных средств — не операционная деятельность.
// Эти ВидОперации помечаем как direction=transfer, чтобы исключать из ДДС/ОПиУ.
const TRANSFER_OPERATIONS = new Set([
  'ПеремещениеДенег',
  'ПереводНаДругойСчет',
  'ПолучениеНаличныхВБанке',
  'ВзносНаличнымиВБанк',
  'ПолучениеВзаймы',         // не совсем перемещение, но это финансовая, не операционная
]);

interface MapsCache {
  kontragentMap: Map<string, string>;
  articleMap: Map<string, string>;
  kassaMap: Map<string, string>;
  bankMap: Map<string, string>;
}

async function loadMaps(): Promise<MapsCache> {
  const [k, a, ks, b] = await Promise.all([
    prisma.kontragent.findMany({ select: { id: true, name: true } }),
    prisma.ddsArticle.findMany({ select: { id: true, name: true } }),
    prisma.kassa.findMany({ select: { id: true, name: true } }),
    prisma.bankAccount.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    kontragentMap: new Map(k.map((x) => [x.id, x.name])),
    articleMap: new Map(a.map((x) => [x.id, x.name])),
    kassaMap: new Map(ks.map((x) => [x.id, x.name])),
    bankMap: new Map(b.map((x) => [x.id, x.name])),
  };
}

// $select намеренно опущен: набор полей у разных документов УНФ отличается
// (Сумма vs СуммаДокумента vs СуммаОперации, Касса vs КассаОрганизации и т.п.).
// Парсим только то, что нашлось.

interface DocConfig {
  resource: string;
  docType: 'PostuplenieVKassu' | 'RashodIzKassy' | 'PostuplenieNaSchet' | 'RashodSoScheta' | 'PeremeschenieDC';
  direction: 'inflow' | 'outflow' | 'transfer';
  hasKassa: boolean;
  hasAccount: boolean;
  hasKassaTo?: boolean;
}

const DOC_CONFIGS: DocConfig[] = [
  { resource: 'Document_ПоступлениеВКассу', docType: 'PostuplenieVKassu', direction: 'inflow', hasKassa: true, hasAccount: false },
  { resource: 'Document_РасходИзКассы', docType: 'RashodIzKassy', direction: 'outflow', hasKassa: true, hasAccount: false },
  { resource: 'Document_ПриходНаРасчетныйСчет', docType: 'PostuplenieNaSchet', direction: 'inflow', hasKassa: false, hasAccount: true },
  { resource: 'Document_РасходСРасчетногоСчета', docType: 'RashodSoScheta', direction: 'outflow', hasKassa: false, hasAccount: true },
  { resource: 'Document_ПеремещениеДенег', docType: 'PeremeschenieDC', direction: 'transfer', hasKassa: true, hasAccount: false, hasKassaTo: true },
];

// Альтернативные имена ресурсов 1С (могут отличаться по конфигурации)
const RESOURCE_ALIASES: Record<string, string[]> = {
  Document_ПриходНаРасчетныйСчет: ['Document_ПоступлениеНаСчет', 'Document_ПриходНаРасчетныйСчет'],
  Document_РасходСРасчетногоСчета: ['Document_РасходСоСчета', 'Document_РасходСРасчетногоСчета'],
  Document_ПеремещениеДенег: ['Document_ПеремещениеДС', 'Document_ПеремещениеДенег'],
};

async function fetchWithAliases(resource: string, opts: any): Promise<DdsRow[]> {
  const aliases = RESOURCE_ALIASES[resource] || [resource];
  let lastErr: any = null;
  for (const r of aliases) {
    try {
      return await fetchAllOData<DdsRow>(r, opts);
    } catch (e: any) {
      lastErr = e;
      // Если это 404 — пробуем следующий алиас
      if (!/40[34]/.test(String(e.message))) throw e;
    }
  }
  throw lastErr || new Error(`No alias worked for ${resource}`);
}

async function syncOneDocType(cfg: DocConfig, since: Date, maps: MapsCache): Promise<{ count: number; ids: string[] }> {
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  const rows = await fetchWithAliases(cfg.resource, { filter });
  const ids = rows.map((r) => r.Ref_Key).filter((id) => !emptyKey(id));

  let count = 0;
  for (const r of rows) {
    if (emptyKey(r.Ref_Key)) continue;
    const date = parseDate(r.Date);
    if (!date) continue;

    // Сумма: СуммаДокумента приоритет, иначе Сумма, иначе СуммаОперации, иначе сумма расшифровки
    let amount = num(r.СуммаДокумента) || num(r.Сумма) || num(r.СуммаОперации);
    if (!amount && r.РасшифровкаПлатежа?.length) {
      amount = r.РасшифровкаПлатежа.reduce((s, p) => s + (num(p.СуммаПлатежа) || num(p.Сумма)), 0);
    }

    // Статья ДДС: в УНФ 1.6 KZ — Статья_Key (шапка). Запасные варианты ниже.
    let articleKey = r.Статья_Key || r.СтатьяДДС_Key;
    if ((!articleKey || emptyKey(articleKey)) && r.РасшифровкаПлатежа?.length) {
      const firstWithArticle = r.РасшифровкаПлатежа.find(
        (p) => (p.Статья_Key && !emptyKey(p.Статья_Key)) || (p.СтатьяДДС_Key && !emptyKey(p.СтатьяДДС_Key)),
      );
      if (firstWithArticle) articleKey = firstWithArticle.Статья_Key || firstWithArticle.СтатьяДДС_Key;
    }

    // Контрагент: из шапки, иначе из расшифровки
    let kontragentKey = r.Контрагент_Key;
    if ((!kontragentKey || emptyKey(kontragentKey)) && r.РасшифровкаПлатежа?.length) {
      const firstWithK = r.РасшифровкаПлатежа.find((p) => p.Контрагент_Key && !emptyKey(p.Контрагент_Key));
      if (firstWithK) kontragentKey = firstWithK.Контрагент_Key;
    }

    const articleId = articleKey && !emptyKey(articleKey) ? articleKey : null;
    const kontragentId = kontragentKey && !emptyKey(kontragentKey) ? kontragentKey : null;

    // Перемещения денег: либо PeremeschenieDC (целиком), либо по ВидОперации
    const isTransfer = cfg.docType === 'PeremeschenieDC' ||
      (r.ВидОперации ? TRANSFER_OPERATIONS.has(r.ВидОперации) : false);
    const direction = isTransfer ? 'transfer' : cfg.direction;

    // ── Резолв сторон документа ──
    // По умолчанию: используем флаги конфига (hasKassa/hasAccount). Для transfer
    // эти флаги дополнительно расширяются ниже — чтобы захватить «вторую сторону»,
    // которая в обычном потоке игнорируется (например, СчетОрганизации_Key
    // на РасходИзКассы при ВзносНаличнымиВБанк = банк-получатель).
    let kassaId: string | null = cfg.hasKassa && r.Касса_Key && !emptyKey(r.Касса_Key) ? r.Касса_Key : null;
    let kassaToId: string | null = cfg.hasKassaTo && r.КассаПолучатель_Key && !emptyKey(r.КассаПолучатель_Key) ? r.КассаПолучатель_Key : null;
    const headerAccountKey = r.БанковскийСчет_Key || r.СчетОрганизации_Key;
    let accountId: string | null = cfg.hasAccount && headerAccountKey && !emptyKey(headerAccountKey) ? headerAccountKey : null;
    let accountToId: string | null = null;

    // ── Захватываем вторую сторону transfer-документов ──
    if (isTransfer && r.ВидОперации) {
      const op = r.ВидОперации;
      // ВзносНаличнымиВБанк: РасходИзКассы. Источник = Касса (уже взяли).
      //   Получатель = СчетОрганизации_Key — пишем в accountId.
      if (op === 'ВзносНаличнымиВБанк' && r.СчетОрганизации_Key && !emptyKey(r.СчетОрганизации_Key)) {
        accountId = r.СчетОрганизации_Key;
      }
      // ПолучениеНаличныхВБанке: ПоступлениеВКассу. Получатель = Касса (уже взяли).
      //   Источник = СчетОрганизации_Key — пишем в accountId.
      else if (op === 'ПолучениеНаличныхВБанке' && r.СчетОрганизации_Key && !emptyKey(r.СчетОрганизации_Key)) {
        accountId = r.СчетОрганизации_Key;
      }
      // ПереводНаДругойСчет: РасходСоСчета. Источник = БанковскийСчет (уже в accountId).
      //   Получатель = СчетКонтрагента_Key (для внутренних переводов это наш же счёт).
      else if (op === 'ПереводНаДругойСчет' && r.СчетКонтрагента_Key && !emptyKey(r.СчетКонтрагента_Key)) {
        accountToId = r.СчетКонтрагента_Key;
      }
    }
    // PeremeschenieDC: тип ДС может быть Наличные или Безналичные с обеих сторон.
    // Источник: Касса_Key (если Наличные) или БанковскийСчет_Key (если Безналичные).
    // Получатель: КассаПолучатель_Key (если Наличные) или БанковскийСчетПолучатель_Key.
    if (cfg.docType === 'PeremeschenieDC') {
      const srcIsBank = r.ТипДенежныхСредств === 'Безналичные';
      const dstIsBank = r.ТипДенежныхСредствПолучатель === 'Безналичные';
      if (srcIsBank) {
        kassaId = null;
        accountId = r.БанковскийСчет_Key && !emptyKey(r.БанковскийСчет_Key) ? r.БанковскийСчет_Key : null;
      }
      if (dstIsBank) {
        kassaToId = null;
        accountToId = r.БанковскийСчетПолучатель_Key && !emptyKey(r.БанковскийСчетПолучатель_Key) ? r.БанковскийСчетПолучатель_Key : null;
      }
    }

    const commission = num(r.СуммаКомиссииДокумента);
    const paymentPurpose = normalizeName(r.НазначениеПлатежа) || null;
    const accrualPeriod = r.ПериодРегистрации ? parseDate(r.ПериодРегистрации) : null;
    const recipientName = normalizeName(r.Выдать) || null;

    const commonFields = {
      docType: cfg.docType,
      direction,
      date,
      number: r.Number || '',
      amount,
      commission,
      kontragentId,
      kontragentName: kontragentId ? maps.kontragentMap.get(kontragentId) || `[${kontragentId.slice(0, 8)}]` : null,
      operationType: r.ВидОперации || null,
      articleId,
      articleName: articleId ? maps.articleMap.get(articleId) || `[${articleId.slice(0, 8)}]` : null,
      kassaId,
      kassaName: kassaId ? maps.kassaMap.get(kassaId) || null : null,
      kassaToId,
      kassaToName: kassaToId ? maps.kassaMap.get(kassaToId) || null : null,
      accountId,
      accountName: accountId ? maps.bankMap.get(accountId) || null : null,
      accountToId,
      accountToName: accountToId ? maps.bankMap.get(accountToId) || null : null,
      comment: normalizeName(r.Комментарий) || null,
      paymentPurpose,
      accrualPeriod,
      recipientName,
      posted: r.Posted !== false,
    };
    await prisma.ddsDocument.upsert({
      where: { id: r.Ref_Key },
      create: { id: r.Ref_Key, ...commonFields },
      update: { ...commonFields, syncedAt: new Date() },
    });
    count++;
  }
  return { count, ids };
}

export async function syncDds(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const maps = await loadMaps();
  const result: Record<string, number> = {};
  const allIds: string[] = [];
  let anyFailed = false;

  for (const cfg of DOC_CONFIGS) {
    try {
      const res = await syncOneDocType(cfg, since, maps);
      result[cfg.docType] = res.count;
      allIds.push(...res.ids);
    } catch (e: any) {
      result[cfg.docType] = -1;
      anyFailed = true;
      console.error(`syncDds ${cfg.docType} failed:`, e.message);
    }
  }

  // ── Purge stale: распроведённые/удалённые в 1С ДДС-документы убираем из БД.
  //    Все типы лежат в одной таблице ddsDocument, поэтому удаляем по объединённому
  //    набору Ref_Key. Если хоть одна загрузка упала — НЕ чистим (иначе удалим нужное). ──
  if (!anyFailed) {
    const dbIds = await prisma.ddsDocument.findMany({ where: { date: { gte: since } }, select: { id: true } });
    const stale = computeStaleIds(dbIds.map((d) => d.id), allIds);
    result.purged = stale.length ? (await prisma.ddsDocument.deleteMany({ where: { id: { in: stale } } })).count : 0;
  } else {
    result.purged = -1; // пропущено из-за ошибки загрузки
  }

  return result;
}

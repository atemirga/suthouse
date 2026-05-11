import { fetchAllOData, dateFilter, combineFilters, POSTED_FILTER } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { normalizeName, emptyKey, parseDate, num, syncSinceDate } from './utils';

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
  Комментарий?: string;
  НазначениеПлатежа?: string;
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

async function syncOneDocType(cfg: DocConfig, since: Date, maps: MapsCache): Promise<number> {
  const filter = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', since));
  const rows = await fetchWithAliases(cfg.resource, { filter });

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
    const kassaId = cfg.hasKassa && r.Касса_Key && !emptyKey(r.Касса_Key) ? r.Касса_Key : null;
    const kassaToId = cfg.hasKassaTo && r.КассаПолучатель_Key && !emptyKey(r.КассаПолучатель_Key) ? r.КассаПолучатель_Key : null;
    // В УНФ KZ счёт хранится в БанковскийСчет_Key, в стандартной УНФ — СчетОрганизации_Key
    const accountKey = r.БанковскийСчет_Key || r.СчетОрганизации_Key;
    const accountId = cfg.hasAccount && accountKey && !emptyKey(accountKey) ? accountKey : null;

    // Перемещения денег: либо PeremeschenieDC (целиком), либо по ВидОперации
    const isTransfer = cfg.docType === 'PeremeschenieDC' ||
      (r.ВидОперации ? TRANSFER_OPERATIONS.has(r.ВидОперации) : false);
    const direction = isTransfer ? 'transfer' : cfg.direction;

    const commission = num(r.СуммаКомиссииДокумента);
    const paymentPurpose = normalizeName(r.НазначениеПлатежа) || null;

    await prisma.ddsDocument.upsert({
      where: { id: r.Ref_Key },
      create: {
        id: r.Ref_Key,
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
        comment: normalizeName(r.Комментарий) || null,
        paymentPurpose,
        posted: r.Posted !== false,
      },
      update: {
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
        comment: normalizeName(r.Комментарий) || null,
        paymentPurpose,
        posted: r.Posted !== false,
        syncedAt: new Date(),
      },
    });
    count++;
  }
  return count;
}

export async function syncDds(daysBack?: number) {
  const since = syncSinceDate(daysBack);
  const maps = await loadMaps();
  const result: Record<string, number> = {};

  for (const cfg of DOC_CONFIGS) {
    try {
      result[cfg.docType] = await syncOneDocType(cfg, since, maps);
    } catch (e: any) {
      result[cfg.docType] = -1;
      console.error(`syncDds ${cfg.docType} failed:`, e.message);
    }
  }
  return result;
}

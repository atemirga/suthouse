// Синхронизация Document_ПланПродаж из 1С УНФ KZ в нашу таблицу SalesPlan.
//
// В 1С УНФ план продаж — управленческий документ, в нём задаются:
//   - период (НачалоПериода / ОкончаниеПериода / Период)
//   - сценарий (Сценарий_Key → Catalog_СценарииПланирования)
//   - ответственный (Ответственный_Key)
//   - табличная часть «Товары»/«Запасы» c количеством, суммой и пр.
//
// Поскольку структура документа может различаться от конфигурации к
// конфигурации (КорпЛП v0.x …), мы пробуем несколько вариантов алиаса
// ресурса и набор полей. Если ничего не подошло — возвращаем noResource:true,
// чтобы пайплайн не падал, а пользователь увидел в /sync-логе, что план
// продаж нужно вводить вручную в /sales/plans.
//
// Маппинг: одна строка табличной части = одна запись SalesPlan со scope='sku'
// (если есть Номенклатура_Key) или scope='category' (если есть категория) или
// scope='manager' (если есть Ответственный_Key). Если ничего из этого нет —
// scope='total'.
//
// ВАЖНО: каждый sync ПЕРЕТИРАЕТ SalesPlan-записи с пометкой `comment` начинающейся
// на «1С:» (это наша метка «пришло из 1С»). Ручные планы (без этой метки)
// не трогаем — пользователь мог их ввести через UI /sales/plans.

import { fetchAllOData } from '@/lib/odata';
import { prisma } from '@/lib/db';
import { emptyKey, parseDate, num } from './utils';

interface PlanRow {
  Ref_Key: string;
  Number?: string;
  Date?: string;
  ПериодНачала?: string;
  ПериодОкончания?: string;
  Период?: string;
  НачалоПериода?: string;
  КонецПериода?: string;
  Сценарий_Key?: string;
  Ответственный_Key?: string;
  Posted?: boolean;
  DeletionMark?: boolean;
  // Возможные табличные части — пробуем оба
  Товары?: PlanItem[];
  Запасы?: PlanItem[];
  СтрокиПлана?: PlanItem[];
}

interface PlanItem {
  Номенклатура_Key?: string;
  Категория_Key?: string;
  Сотрудник_Key?: string;
  Количество?: number;
  Сумма?: number;
  СуммаПлан?: number;
  Цена?: number;
}

const MARKER = '1С:';

// Известные явные имена. Если их нет — пробуем автообнаружение.
const RESOURCE_ALIASES = [
  'Document_ПланПродаж',
  'Document_ПланыПродаж',
  'Document_ПланПродажТоваров',
  'Document_ПланПродажиТоваров',
  'Document_ПланПродажиТоваровИУслуг',
  'Document_БюджетПродаж',
  'Document_ПланированиеПродаж',
  'Document_Plan',
];

// Автообнаружение: тянем корневой service description и ищем любой Document_*,
// чьё имя содержит «план» + «продаж» (либо «продаж» + «план»). Это покроет
// нестандартные имена, которые админ 1С мог дать при публикации в OData.
async function discoverPlanResources(): Promise<string[]> {
  try {
    const base = (process.env.ODATA_URL || '').replace(/\/$/, '');
    if (!base) return [];
    const auth = 'Basic ' + Buffer.from(`${process.env.ODATA_LOGIN}:${process.env.ODATA_PASSWORD}`).toString('base64');
    const resp = await fetch(`${base}/?$format=json`, {
      headers: { Accept: 'application/json;odata=nometadata', Authorization: auth },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const all: Array<{ name?: string; url?: string }> = data.value || [];
    return all
      .map((e) => e.name || e.url || '')
      .filter((n) => /^Document_[^_]+$/.test(n))
      .filter((n) => /план/i.test(n) && /продаж|реализац|выручк/i.test(n));
  } catch (e) {
    console.warn('[sales-plans] discovery failed:', (e as Error).message);
    return [];
  }
}

async function fetchPlans(): Promise<{ rows: PlanRow[]; resourceUsed: string | null }> {
  const discovered = await discoverPlanResources();
  const tried = new Set<string>();
  const candidates = [...discovered, ...RESOURCE_ALIASES];
  for (const r of candidates) {
    if (tried.has(r)) continue;
    tried.add(r);
    try {
      const rows = await fetchAllOData<PlanRow>(r, {});
      return { rows, resourceUsed: r };
    } catch (e: any) {
      // 404/403 — пробуем следующий, остальные ошибки прокидываем.
      if (!/40[34]/.test(String(e.message))) throw e;
    }
  }
  return { rows: [], resourceUsed: null };
}

export interface SalesPlansSyncResult {
  ok: boolean;
  noResource?: boolean;
  resourceUsed?: string;
  documents?: number;
  rows?: number;
  error?: string;
}

export async function syncSalesPlans(): Promise<SalesPlansSyncResult> {
  let docs: PlanRow[];
  let resourceUsed: string | null = null;
  try {
    const r = await fetchPlans();
    docs = r.rows;
    resourceUsed = r.resourceUsed;
    if (!resourceUsed) {
      // Авто-discovery вернул пусто И все известные алиасы — 404. Документа
      // «План продаж» либо нет в этой конфигурации 1С, либо он не опубликован
      // в OData (Администрирование → Стандартный интерфейс OData → Опубликовать).
      return { ok: true, noResource: true };
    }
  } catch (e: any) {
    if (/40[34]/.test(String(e?.message))) {
      return { ok: true, noResource: true };
    }
    return { ok: false, error: e?.message || String(e) };
  }

  // Получаем имена сценариев, сотрудников, номенклатуры — для scopeName.
  const [employees, users, noms] = await Promise.all([
    prisma.employee.findMany({ select: { id: true, name: true } }),
    prisma.user1C.findMany({ select: { id: true, name: true } }),
    prisma.nomenclature.findMany({ select: { id: true, name: true } }),
  ]);
  const empMap = new Map(employees.map((e) => [e.id, e.name]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const nomMap = new Map(noms.map((n) => [n.id, n.name]));

  // Удаляем все ранее засинканные из 1С планы (метка в comment).
  // Это безопасно — пользовательские планы (введённые в /sales/plans без
  // метки 1С:) останутся нетронутыми.
  await prisma.salesPlan.deleteMany({ where: { comment: { startsWith: MARKER } } });

  let rowsInserted = 0;
  for (const d of docs) {
    if (d.DeletionMark || d.Posted === false) continue;
    const start = parseDate(d.ПериодНачала || d.НачалоПериода || d.Период || d.Date);
    const end = parseDate(d.ПериодОкончания || d.КонецПериода);
    if (!start || !end) continue;

    const items = d.Товары || d.Запасы || d.СтрокиПлана || [];
    const respId = d.Ответственный_Key && !emptyKey(d.Ответственный_Key) ? d.Ответственный_Key : null;
    const respName = respId ? (empMap.get(respId) || userMap.get(respId) || null) : null;
    const docNum = d.Number || d.Ref_Key.slice(0, 8);

    if (items.length === 0) {
      // Документ без строк — считаем как «общий план» только если есть
      // ответственный или какая-то сумма.
      continue;
    }

    for (const it of items) {
      const nomId = it.Номенклатура_Key && !emptyKey(it.Номенклатура_Key) ? it.Номенклатура_Key : null;
      const catId = it.Категория_Key && !emptyKey(it.Категория_Key) ? it.Категория_Key : null;
      const sotrId = it.Сотрудник_Key && !emptyKey(it.Сотрудник_Key) ? it.Сотрудник_Key : null;

      let scope: 'sku' | 'category' | 'manager' | 'total' = 'total';
      let scopeId: string | null = null;
      let scopeName: string | null = null;

      if (nomId) {
        scope = 'sku';
        scopeId = nomId;
        scopeName = nomMap.get(nomId) || null;
      } else if (catId) {
        scope = 'category';
        scopeId = catId;
      } else if (sotrId) {
        scope = 'manager';
        scopeId = sotrId;
        scopeName = empMap.get(sotrId) || userMap.get(sotrId) || null;
      } else if (respId) {
        scope = 'manager';
        scopeId = respId;
        scopeName = respName;
      }

      const amount = num(it.СуммаПлан ?? it.Сумма);
      const qty = num(it.Количество);
      if (amount === 0 && qty === 0) continue;

      await prisma.salesPlan.create({
        data: {
          scenarioName: 'Основной',
          startDate: start,
          endDate: end,
          scope,
          scopeId,
          scopeName,
          amountPlan: amount,
          quantityPlan: qty,
          responsible: respName,
          comment: `${MARKER} док. ${docNum} от ${start.toISOString().slice(0, 10)}`,
        },
      });
      rowsInserted++;
    }
  }

  return { ok: true, resourceUsed: resourceUsed!, documents: docs.length, rows: rowsInserted };
}

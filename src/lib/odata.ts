// Клиент 1С OData с пагинацией.
// КРИТИЧНО: $orderby=Ref_Key обязательно, иначе пагинация теряет записи (баг 1С).

const BASE_URL = (process.env.ODATA_URL || '').replace(/\/$/, '');
const LOGIN = process.env.ODATA_LOGIN || '';
const PASSWORD = process.env.ODATA_PASSWORD || '';

const TOP = 1000;

const authHeader = 'Basic ' + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

const baseHeaders = {
  Accept: 'application/json;odata=nometadata',
  Authorization: authHeader,
};

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export interface FetchOptions {
  filter?: string;
  select?: string;
  expand?: string;
  top?: number;
  // Если true — без пагинации, один запрос (для случаев когда заранее знаем что мало записей)
  single?: boolean;
}

function buildUrl(resource: string, opts: FetchOptions, skip: number): string {
  const top = opts.top ?? TOP;
  const params: string[] = [
    '$format=json',
    '$orderby=Ref_Key',
    `$top=${top}`,
    `$skip=${skip}`,
  ];
  if (opts.filter) params.push('$filter=' + encodeURIComponent(opts.filter));
  if (opts.select) params.push('$select=' + encodeURIComponent(opts.select));
  if (opts.expand) params.push('$expand=' + encodeURIComponent(opts.expand));
  return `${BASE_URL}/${resource}?${params.join('&')}`;
}

async function fetchOnce(url: string, attempt = 0): Promise<any> {
  try {
    const resp = await fetch(url, { headers: baseHeaders });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OData ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`);
    }
    return await resp.json();
  } catch (e: any) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return fetchOnce(url, attempt + 1);
    }
    throw e;
  }
}

export async function fetchAllOData<T = any>(
  resource: string,
  opts: FetchOptions = {},
): Promise<T[]> {
  const all: T[] = [];
  let skip = 0;
  const top = opts.top ?? TOP;

  while (true) {
    const url = buildUrl(resource, opts, skip);
    const data = await fetchOnce(url);
    const items: T[] = data.value || [];
    all.push(...items);
    if (opts.single || items.length < top) break;
    skip += top;
  }
  return all;
}

// Стримовая обработка: отдаёт батчи по мере получения, для крупных коллекций.
export async function* streamOData<T = any>(
  resource: string,
  opts: FetchOptions = {},
): AsyncGenerator<T[], void, void> {
  let skip = 0;
  const top = opts.top ?? TOP;
  while (true) {
    const url = buildUrl(resource, opts, skip);
    const data = await fetchOnce(url);
    const items: T[] = data.value || [];
    if (items.length === 0) break;
    yield items;
    if (items.length < top) break;
    skip += top;
  }
}

// Утилита: фильтр по дате 1С (формат datetime'YYYY-MM-DDTHH:MM:SS')
export function dateFilter(field: string, op: 'ge' | 'le' | 'gt' | 'lt', d: Date): string {
  const iso = d.toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss
  return `${field} ${op} datetime'${iso}'`;
}

export function combineFilters(...parts: (string | undefined | null | false)[]): string {
  return parts.filter(Boolean).join(' and ');
}

// Стандартный фильтр для документов: проведённые и не удалённые
export const POSTED_FILTER = 'Posted eq true and DeletionMark eq false';

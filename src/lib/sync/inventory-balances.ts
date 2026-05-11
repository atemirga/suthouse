// Sync остатков товаров на складах из 1С регистра.
// Пишет снимок в InventoryBalance (полная замена при каждом sync).

import { prisma } from '@/lib/db';

const BASE_URL = (process.env.ODATA_URL || '').replace(/\/$/, '');
const LOGIN = process.env.ODATA_LOGIN || '';
const PASSWORD = process.env.ODATA_PASSWORD || '';
const authHeader = 'Basic ' + Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');
const baseHeaders = { Accept: 'application/json;odata=nometadata', Authorization: authHeader };

interface BalanceRow {
  СтруктурнаяЕдиница_Key: string;
  Номенклатура_Key: string;
  КоличествоBalance: number;
}

interface WarehouseRow {
  Ref_Key: string;
  Description: string;
  ТипСтруктурнойЕдиницы?: string;
}

async function fetchAll<T>(url: string): Promise<T[]> {
  const resp = await fetch(url, { headers: baseHeaders });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OData ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { value?: T[] };
  return data.value || [];
}

export async function syncInventoryBalances(opts: { asOfDate?: Date } = {}): Promise<{ asOfDate: Date; count: number; warehouses: number }> {
  const asOfDate = opts.asOfDate || new Date();
  const iso = asOfDate.toISOString().slice(0, 19);

  const [balances, warehouses, nomenclature] = await Promise.all([
    fetchAll<BalanceRow>(`${BASE_URL}/AccumulationRegister_ЗапасыНаСкладах/Balance(Period=datetime'${iso}')?$format=json`),
    fetchAll<WarehouseRow>(`${BASE_URL}/Catalog_СтруктурныеЕдиницы?$format=json&$select=Ref_Key,Description,ТипСтруктурнойЕдиницы`),
    prisma.nomenclature.findMany({ select: { id: true, name: true } }),
  ]);

  const wMap = new Map(warehouses.map((w) => [w.Ref_Key, w.Description]));
  const nMap = new Map(nomenclature.map((n) => [n.id, n.name]));

  // Полная замена — снимок на дату.
  await prisma.inventoryBalance.deleteMany({});

  // Группируем по (склад, номенклатура) — иногда одна позиция в нескольких записях.
  type Key = string;
  const agg = new Map<Key, { wId: string; nId: string; qty: number }>();
  for (const b of balances) {
    const wId = b.СтруктурнаяЕдиница_Key;
    const nId = b.Номенклатура_Key;
    if (!wId || !nId || /^0+-/.test(wId) || /^0+-/.test(nId)) continue;
    const qty = Number(b.КоличествоBalance || 0);
    if (qty === 0) continue;
    const key = `${wId}|${nId}`;
    const cur = agg.get(key);
    if (cur) cur.qty += qty;
    else agg.set(key, { wId, nId, qty });
  }

  const records = Array.from(agg.values()).map((r) => ({
    asOfDate,
    warehouseId: r.wId,
    warehouseName: wMap.get(r.wId) || `[${r.wId.slice(0, 8)}]`,
    nomenclatureId: r.nId,
    nomenclatureName: nMap.get(r.nId) || `[${r.nId.slice(0, 8)}]`,
    quantity: Math.round(r.qty * 1000) / 1000,
  }));

  // Bulk insert батчами, иначе при больших объёмах PostgreSQL может лагать.
  const BATCH = 500;
  for (let i = 0; i < records.length; i += BATCH) {
    await prisma.inventoryBalance.createMany({ data: records.slice(i, i + BATCH) });
  }

  return { asOfDate, count: records.length, warehouses: wMap.size };
}

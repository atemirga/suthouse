// Собираем вступительные FIFO-лоты на 2025-12-31:
// 1. InventoryBalance из 1С (qty остатков по номенклатуре)
// 2. Last purchase price из 1С (последняя закупка до 31.12.2025 на каждую номенклатуру)
// 3. Записать в InventoryOpening как (qty, costPrice)
//
// FIFO потом загружает эти лоты как самую первую партию для каждой номенклатуры.
import { prisma } from '@/lib/db';
import { fetchAllOData } from '@/lib/odata';

const AS_OF = new Date('2025-12-31T23:59:59');

interface BalanceRow {
  СтруктурнаяЕдиница_Key: string;
  Номенклатура_Key: string;
  КоличествоBalance: number;
}

interface ZakupRow {
  Date: string;
  Запасы?: Array<{
    Номенклатура_Key?: string;
    Количество?: number;
    Цена?: number;
  }>;
}

async function main() {
  const isoFilter = AS_OF.toISOString().slice(0, 19);
  console.log(`\n=== Opening inventory on ${AS_OF.toISOString().slice(0, 10)} ===\n`);

  // 1. Получить остатки на дату
  console.log('1. Fetching InventoryBalance from 1С...');
  const url = `${(process.env.ODATA_URL || '').replace(/\/$/, '')}/AccumulationRegister_ЗапасыНаСкладах/Balance(Period=datetime'${isoFilter}')?$format=json`;
  const auth = 'Basic ' + Buffer.from(`${process.env.ODATA_LOGIN}:${process.env.ODATA_PASSWORD}`).toString('base64');
  const resp = await fetch(url, { headers: { Accept: 'application/json;odata=nometadata', Authorization: auth } });
  if (!resp.ok) throw new Error(`OData ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { value: BalanceRow[] };

  // Aggregate by nomenclature (suming across warehouses)
  const qtyByNom = new Map<string, number>();
  for (const b of data.value) {
    const nId = b.Номенклатура_Key;
    if (!nId || /^0+-/.test(nId)) continue;
    const qty = Number(b.КоличествоBalance || 0);
    if (qty === 0) continue;
    qtyByNom.set(nId, (qtyByNom.get(nId) || 0) + qty);
  }
  console.log(`   → ${qtyByNom.size} nomenclatures with non-zero balance`);

  // 2. Last purchase price до AS_OF для каждой номенклатуры.
  // Берём все закупки за 2025 год и оставляем последнюю цену на номенклатуру.
  console.log('\n2. Fetching purchases 2025 (for last cost price)...');
  const purchases = await fetchAllOData<ZakupRow>('Document_ПриходнаяНакладная', {
    filter: `Posted eq true and Date ge datetime'2025-01-01T00:00:00' and Date le datetime'2025-12-31T23:59:59'`,
    select: 'Date,Запасы',
  });
  console.log(`   → ${purchases.length} purchase docs in 2025`);

  // Map: nomenclatureId → { date, price, weightedSum, weightedQty }
  const priceMap = new Map<string, { lastDate: Date; lastPrice: number; wSum: number; wQty: number }>();
  for (const p of purchases) {
    const date = new Date(p.Date);
    for (const it of p.Запасы || []) {
      const id = it.Номенклатура_Key;
      if (!id || /^0+-/.test(id)) continue;
      const price = Number(it.Цена || 0);
      const qty = Number(it.Количество || 0);
      if (price <= 0 || qty <= 0) continue;
      const cur = priceMap.get(id);
      if (!cur) {
        priceMap.set(id, { lastDate: date, lastPrice: price, wSum: price * qty, wQty: qty });
      } else {
        cur.wSum += price * qty;
        cur.wQty += qty;
        if (date.getTime() > cur.lastDate.getTime()) {
          cur.lastDate = date;
          cur.lastPrice = price;
        }
      }
    }
  }
  console.log(`   → ${priceMap.size} nomenclatures with purchase history in 2025`);

  // 3. Подготовить opening lots
  console.log('\n3. Building opening lots...');
  const noms = await prisma.nomenclature.findMany({ select: { id: true, name: true } });
  const nMap = new Map(noms.map((n) => [n.id, n.name]));

  const records: Array<{ id: string; nomenclatureId: string; nomenclatureName: string | null; qty: number; costPrice: number }> = [];
  let withPrice = 0;
  let withFallback = 0;
  let noPrice = 0;
  for (const [nId, qty] of qtyByNom.entries()) {
    const p = priceMap.get(nId);
    let price = 0;
    if (p?.lastPrice && p.lastPrice > 0) {
      price = p.lastPrice;
      withPrice++;
    } else if (p?.wQty && p.wQty > 0) {
      price = p.wSum / p.wQty;
      withFallback++;
    } else {
      noPrice++;
      continue; // skip if no cost info — would be 0 cost = wrong
    }
    records.push({
      id: `opening-2025-12-31-${nId}`,
      nomenclatureId: nId,
      nomenclatureName: nMap.get(nId) || null,
      qty: Math.round(qty * 1000) / 1000,
      costPrice: Math.round(price * 100) / 100,
    });
  }
  console.log(`   → ${withPrice} с last-price, ${withFallback} с weighted-avg, ${noPrice} пропущено (нет закупок 2025)`);

  // 4. Запись в БД
  console.log('\n4. Writing to InventoryOpening...');
  await prisma.inventoryOpening.deleteMany({ where: { asOfDate: AS_OF } });
  for (const r of records) {
    await prisma.inventoryOpening.create({ data: { asOfDate: AS_OF, ...r } });
  }
  console.log(`   → ${records.length} rows inserted`);

  // Summary
  const totalValue = records.reduce((s, r) => s + r.qty * r.costPrice, 0);
  console.log(`\n5. Summary:`);
  console.log(`   Total inventory value at ${AS_OF.toISOString().slice(0,10)}: ${totalValue.toFixed(0)} ₸`);
  console.log(`   (qty=${records.reduce((s,r)=>s+r.qty,0).toFixed(0)} units across ${records.length} SKUs)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });

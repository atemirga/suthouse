// FIFO-расчёт себестоимости реализаций.
//
// ─── Зачем ──────────────────────────────────────────────────────────────────
// Раньше себестоимость считалась как «последняя закупочная цена × проданное
// количество». Это приближение: если цены закупки колебались, реальная
// себестоимость в текущем периоде искажена (особенно при росте цен).
//
// Теперь — настоящий FIFO (First-In-First-Out): каждая закупка кладётся в
// очередь как отдельная партия (qty, price); каждая продажа списывается с
// головы очереди, пока не закроет нужное количество. Так получается
// взвешенная себестоимость, привязанная к реальным партиям.
//
// ─── Как ────────────────────────────────────────────────────────────────────
// 1. Собираем все ZakupkaItem (без возвратов) и RealizaciaItem в один поток,
//    сортированный по дате документа по возрастанию.
// 2. Поддерживаем Map<nomenclatureId, Lot[]>, где Lot = {qty, price}.
// 3. На каждом событии:
//      - Закупка → push в конец очереди.
//      - Продажа → consume from head; считаем общий cost.
// 4. Если на момент продажи в очереди не хватает товара (бывает: история
//    закупок старше окна синка), fallback = взвешенная средняя цена всех
//    известных закупок этого товара. Если закупок вообще нет, costPrice=0.
// 5. Результат пишем в RealizaciaItem.costPrice/costAmount и
//    Realizacia.totalCost — батчами по 1000.
//
// ─── Производительность ────────────────────────────────────────────────────
// Один проход: O(N) по событиям, очереди обычно короткие (<10 партий на
// номенклатуру). На 16K реализаций × 200 номенклатур считается за <2 сек.
// Запись — батчами через executeRaw, чтобы не делать 16K раздельных UPDATE.

import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

interface Lot {
  qty: number;
  price: number;
}

interface ZakupEvent {
  kind: 'buy';
  date: Date;
  nomenclatureId: string;
  qty: number;
  price: number;
}

interface SaleEvent {
  kind: 'sell';
  date: Date;
  nomenclatureId: string;
  qty: number;
  itemId: string;
  realizaciaId: string;
}

interface WriteOffEvent {
  kind: 'writeoff';
  date: Date;
  nomenclatureId: string;
  qty: number;
  itemId: string;
  writeOffId: string;
}

type Event = ZakupEvent | SaleEvent | WriteOffEvent;

interface ItemUpdate {
  itemId: string;
  costPrice: number;
  costAmount: number;
  parentId: string;
}

export interface FifoStats {
  itemsProcessed: number;
  realizationsTouched: number;
  writeOffsTouched: number;
  shortageHits: number; // расходные операции, для которых очередь была пуста — fallback
  noPurchaseEver: number; // расходы без единой закупки этого товара — costPrice=0
  durationMs: number;
}

export async function recomputeFifoCosts(): Promise<FifoStats> {
  const t0 = Date.now();

  const [zakupItems, realizItems, writeOffItems, openingLots] = await Promise.all([
    prisma.zakupkaItem.findMany({
      where: {
        nomenclatureId: { not: null },
        quantity: { gt: 0 },
        zakupka: { isReturn: false, posted: true },
      },
      select: {
        nomenclatureId: true,
        quantity: true,
        price: true,
        zakupka: { select: { date: true } },
      },
    }),
    prisma.realizaciaItem.findMany({
      where: {
        nomenclatureId: { not: null },
        quantity: { gt: 0 },
        realizacia: { posted: true },
      },
      select: {
        id: true,
        realizaciaId: true,
        nomenclatureId: true,
        quantity: true,
        realizacia: { select: { date: true } },
      },
    }),
    prisma.writeOffItem.findMany({
      where: {
        nomenclatureId: { not: null },
        quantity: { gt: 0 },
        writeOff: { posted: true },
      },
      select: {
        id: true,
        writeOffId: true,
        nomenclatureId: true,
        quantity: true,
        writeOff: { select: { date: true } },
      },
    }),
    // Вступительные остатки — «виртуальные закупки» на дату начала учёта.
    // Загружаются в очередь FIFO как самая ранняя партия (price = последняя
    // закупочная цена до этой даты).
    prisma.inventoryOpening.findMany({
      select: { asOfDate: true, nomenclatureId: true, qty: true, costPrice: true },
    }),
  ]);

  // Взвешенная средняя цена закупки на номенклатуру — fallback при недостатке
  // партий в очереди. Учитываем и opening lots, и закупки.
  const fallbackPrice = new Map<string, number>();
  {
    const sumQty = new Map<string, number>();
    const sumAmount = new Map<string, number>();
    for (const z of zakupItems) {
      const id = z.nomenclatureId!;
      sumQty.set(id, (sumQty.get(id) || 0) + z.quantity);
      sumAmount.set(id, (sumAmount.get(id) || 0) + z.price * z.quantity);
    }
    for (const o of openingLots) {
      sumQty.set(o.nomenclatureId, (sumQty.get(o.nomenclatureId) || 0) + o.qty);
      sumAmount.set(o.nomenclatureId, (sumAmount.get(o.nomenclatureId) || 0) + o.costPrice * o.qty);
    }
    for (const [id, q] of sumQty) {
      if (q > 0) fallbackPrice.set(id, (sumAmount.get(id) || 0) / q);
    }
  }

  const events: Event[] = [];
  // Opening lots = виртуальные закупки на дату opening — заходят в очередь первыми.
  for (const o of openingLots) {
    events.push({
      kind: 'buy',
      date: o.asOfDate,
      nomenclatureId: o.nomenclatureId,
      qty: o.qty,
      price: o.costPrice,
    });
  }
  for (const z of zakupItems) {
    events.push({
      kind: 'buy',
      date: z.zakupka.date,
      nomenclatureId: z.nomenclatureId!,
      qty: z.quantity,
      price: z.price,
    });
  }
  for (const r of realizItems) {
    events.push({
      kind: 'sell',
      date: r.realizacia.date,
      nomenclatureId: r.nomenclatureId!,
      qty: r.quantity,
      itemId: r.id,
      realizaciaId: r.realizaciaId,
    });
  }
  for (const w of writeOffItems) {
    events.push({
      kind: 'writeoff',
      date: w.writeOff.date,
      nomenclatureId: w.nomenclatureId!,
      qty: w.quantity,
      itemId: w.id,
      writeOffId: w.writeOffId,
    });
  }

  // Сортировка по дате asc; при равенстве — закупки раньше расходных операций.
  events.sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    if (d !== 0) return d;
    if (a.kind === b.kind) return 0;
    return a.kind === 'buy' ? -1 : 1;
  });

  const queues = new Map<string, Lot[]>();
  const saleUpdates: ItemUpdate[] = [];
  const writeOffUpdates: ItemUpdate[] = [];
  let shortageHits = 0;
  let noPurchaseEver = 0;

  for (const ev of events) {
    if (ev.kind === 'buy') {
      let q = queues.get(ev.nomenclatureId);
      if (!q) {
        q = [];
        queues.set(ev.nomenclatureId, q);
      }
      q.push({ qty: ev.qty, price: ev.price });
      continue;
    }

    // sell / writeoff — обе операции потребляют из той же FIFO-очереди.
    const q = queues.get(ev.nomenclatureId) || [];
    let remaining = ev.qty;
    let costAmount = 0;

    while (remaining > 0 && q.length > 0) {
      const head = q[0];
      const take = Math.min(head.qty, remaining);
      costAmount += take * head.price;
      head.qty -= take;
      remaining -= take;
      if (head.qty <= 1e-9) q.shift();
    }

    if (remaining > 0) {
      // Очередь иссякла — fallback на взвешенную среднюю.
      const fb = fallbackPrice.get(ev.nomenclatureId);
      if (fb && fb > 0) {
        costAmount += remaining * fb;
        shortageHits++;
      } else {
        noPurchaseEver++;
      }
    }

    const costPrice = ev.qty > 0 ? costAmount / ev.qty : 0;
    if (ev.kind === 'sell') {
      saleUpdates.push({ itemId: ev.itemId, costPrice, costAmount, parentId: ev.realizaciaId });
    } else {
      writeOffUpdates.push({ itemId: ev.itemId, costPrice, costAmount, parentId: ev.writeOffId });
    }
  }

  // Запись батчами через CASE … WHEN. UPDATE … FROM (VALUES …) быстрее,
  // чем 16K отдельных UPDATE.
  const BATCH = 500;
  const realizCostSum = new Map<string, number>();
  const writeOffCostSum = new Map<string, number>();

  // 1. RealizaciaItem: costPrice/costAmount
  for (let i = 0; i < saleUpdates.length; i += BATCH) {
    const slice = saleUpdates.slice(i, i + BATCH);
    if (slice.length === 0) continue;
    const values = Prisma.join(
      slice.map(
        (u) =>
          Prisma.sql`(${u.itemId}::text, ${u.costPrice}::double precision, ${u.costAmount}::double precision)`,
      ),
    );
    await prisma.$executeRaw`
      UPDATE "RealizaciaItem" AS ri
      SET "costPrice" = v.cp, "costAmount" = v.ca
      FROM (VALUES ${values}) AS v(id, cp, ca)
      WHERE ri.id = v.id
    `;
    for (const u of slice) {
      realizCostSum.set(u.parentId, (realizCostSum.get(u.parentId) || 0) + u.costAmount);
    }
  }

  // 2. WriteOffItem: costPrice + amount = costAmount (списания тоже считаются по FIFO)
  for (let i = 0; i < writeOffUpdates.length; i += BATCH) {
    const slice = writeOffUpdates.slice(i, i + BATCH);
    if (slice.length === 0) continue;
    const values = Prisma.join(
      slice.map(
        (u) =>
          Prisma.sql`(${u.itemId}::text, ${u.costPrice}::double precision, ${u.costAmount}::double precision)`,
      ),
    );
    await prisma.$executeRaw`
      UPDATE "WriteOffItem" AS wi
      SET "costPrice" = v.cp, "amount" = v.ca
      FROM (VALUES ${values}) AS v(id, cp, ca)
      WHERE wi.id = v.id
    `;
    for (const u of slice) {
      writeOffCostSum.set(u.parentId, (writeOffCostSum.get(u.parentId) || 0) + u.costAmount);
    }
  }

  // 3. Realizacia.totalCost
  const totalCostUpdates = [...realizCostSum.entries()];
  for (let i = 0; i < totalCostUpdates.length; i += BATCH) {
    const slice = totalCostUpdates.slice(i, i + BATCH);
    if (slice.length === 0) continue;
    const values = Prisma.join(
      slice.map(([id, cost]) => Prisma.sql`(${id}::text, ${cost}::double precision)`),
    );
    await prisma.$executeRaw`
      UPDATE "Realizacia" AS r
      SET "totalCost" = v.tc
      FROM (VALUES ${values}) AS v(id, tc)
      WHERE r.id = v.id
    `;
  }

  // 4. WriteOff.totalAmount = сумма costAmount по items
  const writeOffTotalUpdates = [...writeOffCostSum.entries()];
  for (let i = 0; i < writeOffTotalUpdates.length; i += BATCH) {
    const slice = writeOffTotalUpdates.slice(i, i + BATCH);
    if (slice.length === 0) continue;
    const values = Prisma.join(
      slice.map(([id, cost]) => Prisma.sql`(${id}::text, ${cost}::double precision)`),
    );
    await prisma.$executeRaw`
      UPDATE "WriteOff" AS w
      SET "totalAmount" = v.tc
      FROM (VALUES ${values}) AS v(id, tc)
      WHERE w.id = v.id
    `;
  }

  return {
    itemsProcessed: saleUpdates.length + writeOffUpdates.length,
    realizationsTouched: realizCostSum.size,
    writeOffsTouched: writeOffCostSum.size,
    shortageHits,
    noPurchaseEver,
    durationMs: Date.now() - t0,
  };
}

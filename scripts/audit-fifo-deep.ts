// Глубокая FIFO-сверка: симулируем алгоритм прямо в скрипте и сравниваем с БД.
// Если отклонение хотя бы по одной номенклатуре > 0.01 ₸ — есть баг.

import { prisma } from '../src/lib/db';

interface Lot { qty: number; price: number; }

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ГЛУБОКАЯ FIFO-СВЕРКА (симуляция vs БД)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Вытаскиваем все события
  const buys = await prisma.zakupkaItem.findMany({
    where: {
      nomenclatureId: { not: null },
      quantity: { gt: 0 },
      zakupka: { isReturn: false, posted: true },
    },
    select: {
      nomenclatureId: true, quantity: true, price: true,
      zakupka: { select: { date: true } },
    },
  });
  const sells = await prisma.realizaciaItem.findMany({
    where: {
      nomenclatureId: { not: null },
      quantity: { gt: 0 },
      realizacia: { posted: true },
    },
    select: {
      id: true, nomenclatureId: true, quantity: true, costAmount: true,
      realizacia: { select: { date: true } },
    },
  });

  // 2. Fallback цены (взвешенная средняя)
  const fbPrice = new Map<string, number>();
  {
    const sumQ = new Map<string, number>(), sumA = new Map<string, number>();
    for (const b of buys) {
      const id = b.nomenclatureId!;
      sumQ.set(id, (sumQ.get(id) || 0) + b.quantity);
      sumA.set(id, (sumA.get(id) || 0) + b.price * b.quantity);
    }
    for (const [id, q] of sumQ) if (q > 0) fbPrice.set(id, (sumA.get(id) || 0) / q);
  }

  // 3. Симулируем FIFO
  type Ev =
    | { kind: 'buy'; date: Date; nom: string; qty: number; price: number }
    | { kind: 'sell'; date: Date; nom: string; qty: number; itemId: string };
  const events: Ev[] = [];
  for (const b of buys) events.push({ kind: 'buy', date: b.zakupka.date, nom: b.nomenclatureId!, qty: b.quantity, price: b.price });
  for (const s of sells) events.push({ kind: 'sell', date: s.realizacia.date, nom: s.nomenclatureId!, qty: s.quantity, itemId: s.id });
  events.sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    if (d !== 0) return d;
    if (a.kind === b.kind) return 0;
    return a.kind === 'buy' ? -1 : 1;
  });

  const queues = new Map<string, Lot[]>();
  const expectedCost = new Map<string, number>(); // itemId → expectedCost
  let usedFallback = 0;
  let totalShortageQty = 0;
  let totalNoPriceQty = 0;

  for (const ev of events) {
    if (ev.kind === 'buy') {
      let q = queues.get(ev.nom);
      if (!q) { q = []; queues.set(ev.nom, q); }
      q.push({ qty: ev.qty, price: ev.price });
    } else {
      const q = queues.get(ev.nom) || [];
      let need = ev.qty, cost = 0;
      while (need > 0 && q.length > 0) {
        const head = q[0];
        const take = Math.min(head.qty, need);
        cost += take * head.price;
        head.qty -= take;
        need -= take;
        if (head.qty <= 1e-9) q.shift();
      }
      if (need > 0) {
        const fb = fbPrice.get(ev.nom);
        if (fb && fb > 0) {
          cost += need * fb;
          usedFallback++;
          totalShortageQty += need;
        } else {
          totalNoPriceQty += need;
        }
      }
      expectedCost.set(ev.itemId, cost);
    }
  }

  // 4. Сравниваем с БД
  console.log(`Симуляция FIFO: ${events.length} событий обработано`);
  console.log(`├─ Использован fallback в продажах: ${usedFallback}`);
  console.log(`├─ Кол-во товара через fallback:    ${fmt(totalShortageQty)} шт`);
  console.log(`└─ Кол-во товара без цены вообще:   ${fmt(totalNoPriceQty)} шт\n`);

  let totalDbCost = 0, totalSimCost = 0, mismatches = 0, maxDiff = 0;
  let maxDiffItem: { id: string; db: number; sim: number } | null = null;
  for (const s of sells) {
    const sim = expectedCost.get(s.id) || 0;
    const db = s.costAmount;
    totalDbCost += db;
    totalSimCost += sim;
    const diff = Math.abs(db - sim);
    if (diff > 0.01) {
      mismatches++;
      if (diff > maxDiff) { maxDiff = diff; maxDiffItem = { id: s.id, db, sim }; }
    }
  }
  const grandDiff = Math.abs(totalDbCost - totalSimCost);

  console.log('РЕЗУЛЬТАТ ПОПОЗИЦИОННОЙ СВЕРКИ');
  console.log('   ─────────────────────────────────────────');
  console.log(`   Позиций с расхождением > 0.01 ₸:  ${mismatches} / ${sells.length}`);
  console.log(`   Максимальное расхождение:         ${fmt(maxDiff)} ₸`);
  if (maxDiffItem) console.log(`     itemId=${maxDiffItem.id.slice(0, 12)}...  DB=${fmt(maxDiffItem.db)}  sim=${fmt(maxDiffItem.sim)}`);
  console.log(`   Сумма COGS в БД:                  ${fmt(totalDbCost)} ₸`);
  console.log(`   Сумма COGS симуляции:             ${fmt(totalSimCost)} ₸`);
  console.log(`   Глобальное расхождение:           ${fmt(grandDiff)} ₸  ${grandDiff < 1 ? '✓' : '✗'}\n`);

  // 5. Баланс по каждой номенклатуре: bought - sold = qty в остатке очереди
  console.log('БАЛАНС ОЧЕРЕДЕЙ ПО ВСЕМ НОМЕНКЛАТУРАМ');
  console.log('   ─────────────────────────────────────────');
  let balanceErrors = 0;
  for (const [nom, q] of queues) {
    const remainingQty = q.reduce((s, l) => s + l.qty, 0);
    const bought = buys.filter((b) => b.nomenclatureId === nom).reduce((s, b) => s + b.quantity, 0);
    const sold = sells.filter((s) => s.nomenclatureId === nom).reduce((s, x) => s + x.quantity, 0);
    // Если остаток отрицательный — был fallback. Иначе ожидаем bought - sold == remaining.
    const expected = Math.max(0, bought - sold);
    const diff = Math.abs(remainingQty - expected);
    if (diff > 1e-6) balanceErrors++;
  }
  console.log(`   Номенклатур с нарушением баланса очереди: ${balanceErrors}  ${balanceErrors === 0 ? '✓' : '✗'}`);
  console.log(`   (Каждая очередь должна содержать ровно (закуплено - продано) единиц)\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ВЕРДИКТ: ${grandDiff < 1 && mismatches === 0 && balanceErrors === 0 ? '✓ FIFO РАБОТАЕТ КОРРЕКТНО' : '✗ ЕСТЬ РАСХОЖДЕНИЯ'}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });

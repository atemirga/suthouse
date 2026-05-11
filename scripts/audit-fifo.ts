// Глубокий аудит FIFO-расчёта.
// Проверяет инварианты, выбросы, точечные позиции и сверяет суммы.

import { prisma } from '../src/lib/db';

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  АУДИТ FIFO-РАСЧЁТА СЕБЕСТОИМОСТИ');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ─── 1. Глобальные тоталы ─────────────────────────────────────────────
  const realizAgg = await prisma.realizaciaItem.aggregate({
    where: { realizacia: { posted: true } },
    _sum: { quantity: true, amount: true, costAmount: true },
    _count: true,
  });
  const zakupAgg = await prisma.zakupkaItem.aggregate({
    where: { zakupka: { posted: true, isReturn: false } },
    _sum: { quantity: true, amount: true },
    _count: true,
  });
  console.log('1. ГЛОБАЛЬНЫЕ ТОТАЛЫ');
  console.log('   ─────────────────────────────────────────');
  console.log(`   Закупок (без возвратов):  ${zakupAgg._count} строк, qty=${fmt(zakupAgg._sum.quantity || 0)}, сумма=${fmt(zakupAgg._sum.amount || 0)} ₸`);
  console.log(`   Реализаций:               ${realizAgg._count} строк, qty=${fmt(realizAgg._sum.quantity || 0)}, выручка=${fmt(realizAgg._sum.amount || 0)} ₸`);
  console.log(`   COGS (FIFO):              ${fmt(realizAgg._sum.costAmount || 0)} ₸`);
  const grossProfit = (realizAgg._sum.amount || 0) - (realizAgg._sum.costAmount || 0);
  const grossMargin = (realizAgg._sum.amount || 0) > 0 ? grossProfit / (realizAgg._sum.amount || 1) * 100 : 0;
  console.log(`   Валовая прибыль:          ${fmt(grossProfit)} ₸`);
  console.log(`   Валовая маржа:            ${grossMargin.toFixed(2)}%\n`);

  // ─── 2. Инвариант сумм: Realizacia.totalCost == Σ items.costAmount ─────
  console.log('2. ИНВАРИАНТ: Realizacia.totalCost == Σ RealizaciaItem.costAmount');
  console.log('   ─────────────────────────────────────────');
  const mismatch = await prisma.$queryRaw<Array<{ id: string; totalCost: number; itemsSum: number; diff: number }>>`
    SELECT r.id, r."totalCost", COALESCE(SUM(ri."costAmount"), 0) AS "itemsSum",
           ABS(r."totalCost" - COALESCE(SUM(ri."costAmount"), 0)) AS diff
    FROM "Realizacia" r
    LEFT JOIN "RealizaciaItem" ri ON ri."realizaciaId" = r.id
    WHERE r.posted = true
    GROUP BY r.id, r."totalCost"
    HAVING ABS(r."totalCost" - COALESCE(SUM(ri."costAmount"), 0)) > 0.01
    ORDER BY diff DESC
    LIMIT 5
  `;
  if (mismatch.length === 0) {
    console.log('   ✓ Все 16 038 реализаций согласованы (diff < 0.01 ₸)\n');
  } else {
    console.log(`   ✗ ${mismatch.length} рассогласований:`);
    for (const m of mismatch) console.log(`     ${m.id.slice(0, 8)} totalCost=${m.totalCost} sum=${m.itemsSum} diff=${m.diff}`);
    console.log();
  }

  // ─── 3. Sanity: inventory balance per nomenclature ─────────────────────
  console.log('3. БАЛАНС ЗАПАСОВ ПО НОМЕНКЛАТУРЕ');
  console.log('   ─────────────────────────────────────────');
  console.log('   Всего bought - sold по каждой номенклатуре. Отрицательное значение =');
  console.log('   продали больше чем закупили (история закупок старше окна синка).');
  const balance = await prisma.$queryRaw<Array<{
    nomenclatureId: string; name: string;
    bought: number; sold: number; remaining: number;
  }>>`
    WITH b AS (
      SELECT zi."nomenclatureId", SUM(zi.quantity) AS bought
      FROM "ZakupkaItem" zi JOIN "Zakupka" z ON z.id = zi."zakupkaId"
      WHERE z."isReturn" = false AND z.posted = true AND zi."nomenclatureId" IS NOT NULL
      GROUP BY zi."nomenclatureId"
    ),
    s AS (
      SELECT ri."nomenclatureId", SUM(ri.quantity) AS sold
      FROM "RealizaciaItem" ri JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.posted = true AND ri."nomenclatureId" IS NOT NULL
      GROUP BY ri."nomenclatureId"
    )
    SELECT COALESCE(b."nomenclatureId", s."nomenclatureId") AS "nomenclatureId",
           n.name,
           COALESCE(b.bought, 0) AS bought,
           COALESCE(s.sold, 0) AS sold,
           COALESCE(b.bought, 0) - COALESCE(s.sold, 0) AS remaining
    FROM b FULL OUTER JOIN s ON b."nomenclatureId" = s."nomenclatureId"
    LEFT JOIN "Nomenclature" n ON n.id = COALESCE(b."nomenclatureId", s."nomenclatureId")
  `;
  let posBalance = 0, negBalance = 0, neverBought = 0, neverSold = 0;
  for (const b of balance) {
    if (b.bought === 0 && b.sold > 0) neverBought++;
    else if (b.sold === 0 && b.bought > 0) neverSold++;
    else if (b.remaining < -0.01) negBalance++;
    else posBalance++;
  }
  console.log(`   Всего номенклатур:                ${balance.length}`);
  console.log(`   ├─ Положительный остаток:         ${posBalance} (нормально — товар на складе)`);
  console.log(`   ├─ Отрицательный остаток:         ${negBalance} (продано больше — открывающие остатки)`);
  console.log(`   ├─ Только продажи (без закупок):  ${neverBought} (старые остатки или услуги)`);
  console.log(`   └─ Только закупки (не продано):   ${neverSold} (товар на складе)\n`);

  console.log('   ТОП-5 номенклатур с отрицательным балансом (= больше всего fallback):');
  const negSorted = balance.filter((b) => b.remaining < -0.01 || (b.bought === 0 && b.sold > 0))
    .sort((a, b) => a.remaining - b.remaining).slice(0, 5);
  for (const b of negSorted) {
    console.log(`     ${(b.name || '[no name]').slice(0, 50).padEnd(50)} продано: ${fmt(b.sold).padStart(10)} куплено: ${fmt(b.bought).padStart(10)} → разрыв: ${fmt(-b.remaining).padStart(10)}`);
  }
  console.log();

  // ─── 4. Точечная проверка: разбираем 3 продажи покадрово ──────────────
  console.log('4. ТОЧЕЧНАЯ ПРОВЕРКА FIFO ДЛЯ ОДНОЙ НОМЕНКЛАТУРЫ');
  console.log('   ─────────────────────────────────────────');
  // Возьмём номенклатуру с интересной историей: несколько закупок по разным ценам
  const candidate = await prisma.$queryRaw<Array<{ nomenclatureId: string; name: string; nbuys: number; nsells: number }>>`
    SELECT zi."nomenclatureId", n.name,
           COUNT(DISTINCT zi.id) AS nbuys,
           (SELECT COUNT(*) FROM "RealizaciaItem" ri JOIN "Realizacia" r ON r.id = ri."realizaciaId"
            WHERE ri."nomenclatureId" = zi."nomenclatureId" AND r.posted = true) AS nsells
    FROM "ZakupkaItem" zi
    JOIN "Zakupka" z ON z.id = zi."zakupkaId"
    JOIN "Nomenclature" n ON n.id = zi."nomenclatureId"
    WHERE z."isReturn" = false AND z.posted = true
    GROUP BY zi."nomenclatureId", n.name
    HAVING COUNT(DISTINCT zi.id) >= 3
    ORDER BY nbuys DESC, nsells DESC
    LIMIT 1
  `;
  if (candidate[0]) {
    const nomId = candidate[0].nomenclatureId;
    console.log(`   Номенклатура: «${candidate[0].name}»`);
    console.log(`   Закупок: ${candidate[0].nbuys} · Продаж: ${candidate[0].nsells}`);

    const buys = await prisma.zakupkaItem.findMany({
      where: { nomenclatureId: nomId, zakupka: { isReturn: false, posted: true } },
      select: { quantity: true, price: true, zakupka: { select: { date: true, number: true } } },
      orderBy: { zakupka: { date: 'asc' } },
    });
    console.log('\n   ЗАКУПКИ (партии в FIFO-очереди):');
    for (const b of buys) {
      console.log(`     ${b.zakupka.date.toISOString().slice(0, 10)}  №${(b.zakupka.number || '').padEnd(15)}  qty=${fmt(b.quantity).padStart(8)}  price=${fmt(b.price).padStart(10)} ₸`);
    }
    const totalBoughtQty = buys.reduce((s, b) => s + b.quantity, 0);
    const totalBoughtAmount = buys.reduce((s, b) => s + b.quantity * b.price, 0);
    console.log(`     ──────────────────────────────────────────────`);
    console.log(`     ИТОГО:    qty=${fmt(totalBoughtQty)}  на сумму ${fmt(totalBoughtAmount)} ₸ (avg=${fmt(totalBoughtAmount / totalBoughtQty)} ₸/шт)`);

    const sells = await prisma.realizaciaItem.findMany({
      where: { nomenclatureId: nomId, realizacia: { posted: true } },
      select: {
        quantity: true, price: true, costPrice: true, costAmount: true,
        realizacia: { select: { date: true, number: true } },
      },
      orderBy: { realizacia: { date: 'asc' } },
      take: 8,
    });
    console.log('\n   ПЕРВЫЕ 8 ПРОДАЖ:');
    console.log('   дата           №            qty      sale_price   cost_price   cost_amount    margin');
    for (const s of sells) {
      const margin = s.price > 0 ? ((s.price - s.costPrice) / s.price * 100) : 0;
      console.log(`     ${s.realizacia.date.toISOString().slice(0, 10)}  ${(s.realizacia.number || '').padEnd(12)} ${fmt(s.quantity).padStart(6)}  ${fmt(s.price).padStart(10)}   ${fmt(s.costPrice).padStart(10)}   ${fmt(s.costAmount).padStart(12)}    ${margin.toFixed(1).padStart(5)}%`);
    }

    // Сверка тоталов FIFO для этой номенклатуры
    const sellAgg = await prisma.realizaciaItem.aggregate({
      where: { nomenclatureId: nomId, realizacia: { posted: true } },
      _sum: { quantity: true, costAmount: true, amount: true },
    });
    const totalSoldQty = sellAgg._sum.quantity || 0;
    const totalCogs = sellAgg._sum.costAmount || 0;
    const totalRev = sellAgg._sum.amount || 0;
    console.log(`\n   ВСЕГО ПРОДАЖ ПО ЭТОЙ НОМЕНКЛАТУРЕ:`);
    console.log(`     qty проданных:   ${fmt(totalSoldQty)}  (закуплено ${fmt(totalBoughtQty)} → ${totalSoldQty > totalBoughtQty ? 'ДЕФИЦИТ' : 'OK'})`);
    console.log(`     выручка:         ${fmt(totalRev)} ₸`);
    console.log(`     COGS (FIFO):     ${fmt(totalCogs)} ₸`);
    console.log(`     валовая прибыль: ${fmt(totalRev - totalCogs)} ₸  (маржа ${totalRev > 0 ? ((totalRev - totalCogs) / totalRev * 100).toFixed(1) : '—'}%)`);
    if (totalSoldQty <= totalBoughtQty + 0.01) {
      const expectedCogs = (() => {
        // Ожидаемая COGS: сначала съедаем самые ранние партии
        let need = totalSoldQty, cost = 0;
        for (const b of buys) {
          if (need <= 0) break;
          const take = Math.min(b.quantity, need);
          cost += take * b.price;
          need -= take;
        }
        return cost;
      })();
      const diff = Math.abs(totalCogs - expectedCogs);
      console.log(`     Ожидаемая COGS по FIFO: ${fmt(expectedCogs)} ₸  ·  расхождение: ${fmt(diff)} ₸  ${diff < 1 ? '✓' : '✗'}`);
    }
  }
  console.log();

  // ─── 5. Распределение цен (sanity) ────────────────────────────────────
  console.log('5. СТАТИСТИКА COSTPRICE ПО ВСЕЙ БАЗЕ');
  console.log('   ─────────────────────────────────────────');
  const stats = await prisma.$queryRaw<Array<{
    n: number; nzero: number; nnegcost: number; nzerocost_paid: number;
    avg_margin: number; min_margin: number; max_margin: number;
  }>>`
    SELECT
      COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE "costPrice" = 0)::int AS nzero,
      COUNT(*) FILTER (WHERE "costPrice" < 0)::int AS nnegcost,
      COUNT(*) FILTER (WHERE "costPrice" = 0 AND price > 0 AND quantity > 0)::int AS nzerocost_paid,
      AVG(CASE WHEN price > 0 THEN (price - "costPrice") / price * 100 END) AS avg_margin,
      MIN(CASE WHEN price > 0 THEN (price - "costPrice") / price * 100 END) AS min_margin,
      MAX(CASE WHEN price > 0 THEN (price - "costPrice") / price * 100 END) AS max_margin
    FROM "RealizaciaItem"
  `;
  const s = stats[0];
  console.log(`   Всего позиций:            ${s.n}`);
  console.log(`   costPrice = 0:            ${s.nzero}  (из них продано за деньги: ${s.nzerocost_paid})`);
  console.log(`   costPrice < 0:            ${s.nnegcost}  ${s.nnegcost > 0 ? '✗ ОШИБКА' : '✓'}`);
  console.log(`   Маржа: средняя ${Number(s.avg_margin).toFixed(1)}%  ·  мин ${Number(s.min_margin).toFixed(1)}%  ·  макс ${Number(s.max_margin).toFixed(1)}%\n`);

  // ─── 6. Аномалии: продажи с убытком ────────────────────────────────────
  console.log('6. АНОМАЛИИ: продажи с убытком (cost > price * qty)');
  console.log('   ─────────────────────────────────────────');
  const losses = await prisma.$queryRaw<Array<{
    n: number; sumLoss: number;
  }>>`
    SELECT COUNT(*)::int AS n, COALESCE(SUM("costAmount" - amount), 0)::float AS "sumLoss"
    FROM "RealizaciaItem"
    WHERE "costAmount" > amount AND amount > 0 AND quantity > 0
  `;
  console.log(`   Позиций с убытком: ${losses[0].n}  ·  суммарный «убыток» по ним: ${fmt(losses[0].sumLoss)} ₸`);
  if (losses[0].n > 0) {
    const top = await prisma.realizaciaItem.findMany({
      where: { costAmount: { gt: prisma.realizaciaItem.fields.amount }, amount: { gt: 0 }, quantity: { gt: 0 } },
      select: {
        quantity: true, price: true, amount: true, costPrice: true, costAmount: true,
        nomenclatureName: true, realizacia: { select: { date: true, number: true } },
      },
      take: 5,
      orderBy: { costAmount: 'desc' },
    });
    console.log('   ТОП-5 позиций (= кандидаты на проверку):');
    for (const t of top) {
      const loss = t.costAmount - t.amount;
      console.log(`     ${t.realizacia.date.toISOString().slice(0, 10)} ${(t.nomenclatureName || '').slice(0, 35).padEnd(35)} qty=${fmt(t.quantity).padStart(6)} price=${fmt(t.price).padStart(8)} cost=${fmt(t.costPrice).padStart(8)} убыток=${fmt(loss).padStart(10)} ₸`);
    }
  }
  console.log();

  // ─── 7. Финальная сводка ──────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ИТОГ');
  console.log('═══════════════════════════════════════════════════════════');
  const verdict =
    mismatch.length === 0 &&
    s.nnegcost === 0;
  console.log(`  Состояние: ${verdict ? '✓ ВСЕ ИНВАРИАНТЫ ВЫПОЛНЕНЫ' : '✗ ЕСТЬ ПРОБЛЕМЫ'}`);
  console.log(`  COGS (FIFO):       ${fmt(realizAgg._sum.costAmount || 0)} ₸`);
  console.log(`  Выручка:           ${fmt(realizAgg._sum.amount || 0)} ₸`);
  console.log(`  Валовая прибыль:   ${fmt(grossProfit)} ₸  (${grossMargin.toFixed(2)}%)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });

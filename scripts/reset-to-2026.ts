// Чистка БД до 2026-01-01:
// 1. Снимаем снимок дебиторки/кредиторки/касс на 2025-12-31 → новый OpeningBalance
// 2. Удаляем все документы до 2026-01-01 + старые OpeningBalance
// 3. После этого синк синкает только с 2026-01-01 (см. SYNC_SINCE_DATE в .env)
import { prisma } from '@/lib/db';
import { buildReceivables } from '@/lib/reports/receivables';
import { buildPayables } from '@/lib/reports/payables';

const SNAPSHOT_DATE = new Date('2025-12-31T23:59:59.999Z');
const CUTOFF = new Date('2026-01-01T00:00:00.000Z');

async function buildCashSnapshot() {
  // Берём текущий opening_cash + все DDS до 31.12.2025
  const [openingCash, dds] = await Promise.all([
    prisma.openingBalance.findMany({
      where: { kind: 'cash' },
      select: { refId: true, refName: true, refType: true, amount: true },
    }),
    prisma.ddsDocument.findMany({
      where: { date: { lte: SNAPSHOT_DATE } },
      select: {
        amount: true, direction: true, docType: true,
        kassaId: true, kassaName: true, kassaToId: true, kassaToName: true,
        accountId: true, accountName: true,
      },
    }),
  ]);

  const map = new Map<string, { name: string; type: 'kassa' | 'bank'; balance: number }>();
  for (const o of openingCash) {
    map.set(o.refId, { name: o.refName || '—', type: (o.refType as any) || 'kassa', balance: o.amount });
  }
  function bump(name: string | null, id: string | null, isBank: boolean, amount: number) {
    if (!id || !name) return;
    let v = map.get(id);
    if (!v) { v = { name, type: isBank ? 'bank' : 'kassa', balance: 0 }; map.set(id, v); }
    else if (!v.name || v.name === '—') v.name = name;
    v.balance += amount;
  }
  for (const d of dds) {
    if (d.docType === 'PeremeschenieDC') {
      bump(d.kassaName, d.kassaId, false, -d.amount);
      bump(d.kassaToName, d.kassaToId, false, d.amount);
      continue;
    }
    const sign = d.direction === 'inflow' ? 1 : d.direction === 'outflow' ? -1 : 0;
    if (sign === 0) continue;
    if (d.kassaId) bump(d.kassaName, d.kassaId, false, sign * d.amount);
    if (d.accountId) bump(d.accountName, null, true, sign * d.amount);
    // NB: bump(accountName, accountId, true) — баг в исходном dashboard: id передавался как kassaId.
    // Здесь делаем корректно.
  }

  // Reconstruct list with real ids for bank accounts: re-iterate
  const bankBalances = new Map<string, { name: string; balance: number }>();
  for (const d of dds) {
    if (d.docType === 'PeremeschenieDC') continue;
    const sign = d.direction === 'inflow' ? 1 : d.direction === 'outflow' ? -1 : 0;
    if (sign === 0) continue;
    if (d.accountId && d.accountName) {
      const v = bankBalances.get(d.accountId) || { name: d.accountName, balance: 0 };
      v.balance += sign * d.amount;
      bankBalances.set(d.accountId, v);
    }
  }
  // Merge bank into map by id
  for (const [id, v] of bankBalances) {
    const opening = openingCash.find((o) => o.refId === id);
    const startAmt = opening?.amount || 0;
    map.set(id, { name: v.name, type: 'bank', balance: startAmt + v.balance });
  }

  return Array.from(map.entries())
    .filter(([_, v]) => Math.abs(v.balance) > 0.5)
    .map(([id, v]) => ({
      kind: 'cash' as const,
      refId: id,
      refName: v.name,
      refType: v.type,
      amount: Math.round(v.balance * 100) / 100,
    }));
}

async function main() {
  console.log(`\n=== Snapshot on ${SNAPSHOT_DATE.toISOString().slice(0,10)} ===\n`);

  console.log('1. Building AR snapshot...');
  const receivables = await buildReceivables({ asOf: SNAPSHOT_DATE, minDebt: 0.5 });
  const arRows = receivables.rows
    .filter((r) => Math.abs(r.totalDebt - r.prepayment) > 0.5 || Math.abs(r.prepayment) > 0.5)
    .map((r) => ({
      kind: 'ar' as const,
      refId: r.kontragentId,
      refName: r.kontragentName || '—',
      refType: 'kontragent',
      // Positive = клиент должен нам, negative = аванс получен от клиента
      amount: Math.round((r.totalDebt - r.prepayment) * 100) / 100,
    }))
    .filter((r) => Math.abs(r.amount) > 0.5);
  console.log(`   → ${arRows.length} contragents with AR balance`);
  console.log(`   → totals: positive=${arRows.filter((r) => r.amount > 0).length}, negative=${arRows.filter((r) => r.amount < 0).length}`);
  console.log(`   → sum: ${arRows.reduce((s, r) => s + r.amount, 0).toFixed(0)}`);

  console.log('\n2. Building AP snapshot...');
  const payables = await buildPayables({ asOf: SNAPSHOT_DATE, minDebt: 0.5 });
  const apRows = payables.rows
    .filter((r) => Math.abs(r.totalDebt) > 0.5 || Math.abs(r.prepayment) > 0.5)
    .map((r) => ({
      kind: 'ap' as const,
      refId: r.kontragentId,
      refName: r.kontragentName || '—',
      refType: 'kontragent',
      // Positive = мы должны поставщику, negative = аванс выдан поставщику
      amount: Math.round((r.totalDebt - r.prepayment) * 100) / 100,
    }))
    .filter((r) => Math.abs(r.amount) > 0.5);
  console.log(`   → ${apRows.length} contragents with AP balance`);
  console.log(`   → sum: ${apRows.reduce((s, r) => s + r.amount, 0).toFixed(0)}`);

  console.log('\n3. Building cash snapshot...');
  const cashRows = await buildCashSnapshot();
  console.log(`   → ${cashRows.length} kassas/accounts`);
  console.log(`   → total cash: ${cashRows.reduce((s, r) => s + r.amount, 0).toFixed(0)}`);
  for (const c of cashRows) {
    console.log(`     ${c.refName.padEnd(30)} | ${c.refType.padEnd(5)} | ${c.amount.toFixed(0)}`);
  }

  const allNew = [...arRows, ...apRows, ...cashRows];
  console.log(`\n   Total new OpeningBalance rows: ${allNew.length}`);

  console.log('\n=== Cleanup ===\n');
  await prisma.$transaction(
    async (tx) => {
      console.log('4. Deleting old data...');
      const realiz = await tx.realizacia.deleteMany({ where: { date: { lt: CUTOFF } } });
      console.log(`   Realizacia: ${realiz.count}`);
      const zakup = await tx.zakupka.deleteMany({ where: { date: { lt: CUTOFF } } });
      console.log(`   Zakupka: ${zakup.count}`);
      const dds = await tx.ddsDocument.deleteMany({ where: { date: { lt: CUTOFF } } });
      console.log(`   DdsDocument: ${dds.count}`);
      const orders = await tx.orderBuyer.deleteMany({ where: { date: { lt: CUTOFF } } });
      console.log(`   OrderBuyer: ${orders.count}`);
      const writeoffs = await tx.writeOff.deleteMany({ where: { date: { lt: CUTOFF } } });
      console.log(`   WriteOff: ${writeoffs.count}`);
      const caps = await tx.capitalization.deleteMany({ where: { date: { lt: CUTOFF } } });
      console.log(`   Capitalization: ${caps.count}`);
      const closes = await tx.monthClose.deleteMany({ where: { yearMonth: { lt: '2026-01' } } });
      console.log(`   MonthClose: ${closes.count}`);
      const oldOpen = await tx.openingBalance.deleteMany({});
      console.log(`   OpeningBalance (old): ${oldOpen.count}`);

      console.log('\n5. Inserting new OpeningBalance on 2025-12-31...');
      for (const o of allNew) {
        await tx.openingBalance.create({
          data: {
            id: `${o.kind}-${o.refId}`,
            asOfDate: SNAPSHOT_DATE,
            kind: o.kind,
            refId: o.refId,
            refName: o.refName,
            refType: o.refType,
            amount: o.amount,
          },
        });
      }
      console.log(`   Inserted: ${allNew.length}`);
    },
    { timeout: 120_000 },
  );

  console.log('\n=== Done. New starting point: 2026-01-01 ===');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });

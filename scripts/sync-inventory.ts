import { syncInventoryBalances } from '../src/lib/sync/inventory-balances';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Syncing inventory balances...');
  const r = await syncInventoryBalances();
  console.log(`asOfDate: ${r.asOfDate.toISOString()}`);
  console.log(`Записей: ${r.count}`);
  console.log(`Складов в каталоге: ${r.warehouses}`);

  const grouped = await prisma.inventoryBalance.groupBy({
    by: ['warehouseName'],
    _sum: { quantity: true },
    _count: true,
  });
  console.log('\nПо складам:');
  for (const g of grouped) {
    console.log(`  ${g.warehouseName}: ${g._count} позиций, всего ${(g._sum.quantity || 0).toLocaleString('ru-RU')} шт.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

// Sync категорий номенклатуры + bind nomenclature.categoryId.
import { syncNomenclatureCategories, syncNomenclature } from '../src/lib/sync/catalogs';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Syncing nomenclature categories...');
  const cats = await syncNomenclatureCategories();
  console.log('Categories synced:', cats);

  console.log('Re-syncing nomenclature (для подвязки categoryId)...');
  const noms = await syncNomenclature();
  console.log('Nomenclature updated:', noms);

  const grouped = await prisma.nomenclature.groupBy({
    by: ['categoryId'],
    _count: true,
  });
  const catNames = await prisma.nomenclatureCategory.findMany({ select: { id: true, name: true } });
  const nameMap = new Map(catNames.map((c) => [c.id, c.name]));
  console.log('\nNomenclature by category:');
  for (const g of grouped.sort((a, b) => b._count - a._count)) {
    const name = g.categoryId ? nameMap.get(g.categoryId) || g.categoryId : '— без категории —';
    console.log(`  ${name}: ${g._count}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

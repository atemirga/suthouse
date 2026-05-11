// Sync источников привлечения + бэкфил attractionSourceId по контрагентам.
import { syncAttractionSources, syncKontragenty } from '../src/lib/sync/catalogs';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Syncing attraction sources...');
  const n = await syncAttractionSources();
  console.log('Sources synced:', n);

  const sources = await prisma.attractionSource.findMany();
  console.log('Sources in DB:', sources.map((s) => s.name).join(', '));

  console.log('Re-syncing kontragenty (для обновления attractionSourceId)...');
  const k = await syncKontragenty();
  console.log('Kontragents updated:', k);

  const grouped = await prisma.kontragent.groupBy({
    by: ['attractionSourceId'],
    _count: true,
  });
  console.log('\nKontragents by source:');
  for (const g of grouped) {
    const name = g.attractionSourceId ? sources.find((s) => s.id === g.attractionSourceId)?.name || g.attractionSourceId : '— без источника —';
    console.log(`  ${name}: ${g._count}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

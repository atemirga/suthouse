import { syncOpeningBalances } from '../src/lib/sync/openings';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Computing as-of date and syncing opening balances...');
  const r = await syncOpeningBalances();
  console.log('asOfDate:', r.asOfDate.toISOString());
  console.log('Cash total:', r.cash.toFixed(2));
  console.log('AR total (нам должны):', r.ar.toFixed(2));
  console.log('AP total (мы должны):', r.ap.toFixed(2));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

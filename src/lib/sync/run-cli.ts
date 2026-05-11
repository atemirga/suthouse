// CLI обёртка: npm run sync [-- --days=30] [--skip-catalogs]
import { runFullSync } from './index';

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) : undefined;
  const skipCatalogs = args.includes('--skip-catalogs');

  console.log(`[sync] start daysBack=${days ?? process.env.SYNC_DAYS_BACK ?? 60} skipCatalogs=${skipCatalogs}`);
  const r = await runFullSync({ daysBack: days, skipCatalogs });
  console.log(`[sync] ${r.ok ? 'OK' : 'FAIL'} in ${r.durationMs}ms`);
  console.log(JSON.stringify(r.details, null, 2));
  if (!r.ok) {
    console.error('[sync] error:', r.error);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

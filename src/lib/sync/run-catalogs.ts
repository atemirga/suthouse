// Смоук-тест: только справочники
import { syncAllCatalogs } from './catalogs';

async function main() {
  console.log('[catalogs-only] start');
  const t0 = Date.now();
  const r = await syncAllCatalogs();
  console.log(`[catalogs-only] OK in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error('[catalogs-only] FAIL:', e?.message || e);
  process.exit(1);
});

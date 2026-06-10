// Грузим .env вручную и дальше через динамический require — иначе
// импорт `orders.ts` поднимется выше env-loader и BASE_URL будет пуст.
import { readFileSync } from 'fs';
import { resolve } from 'path';
for (const line of readFileSync(resolve(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

// Аргумент CLI: число дней назад. Без аргумента — полный синк (вся история).
const daysArg = process.argv[2] ? Number(process.argv[2]) : undefined;

(async () => {
  const { syncOrders } = await import('../src/lib/sync/orders');
  const label = daysArg ? `syncOrders(${daysArg})` : 'syncOrders() FULL';
  console.log(`Starting ${label}...`);
  const t0 = Date.now();
  const count = await syncOrders(daysArg);
  console.log(`Done. ${count} orders in ${Date.now() - t0}ms`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

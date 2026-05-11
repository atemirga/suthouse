// Долгоживущий cron-процесс: запускается отдельно от Next.js (npm run cron),
// каждые SYNC_INTERVAL_MINUTES минут вызывает runFullSync.
import cron from 'node-cron';
import { runFullSync } from './sync';

const intervalMin = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
const expr = `*/${Math.max(1, intervalMin)} * * * *`;

console.log(`[cron] starting, schedule="${expr}" (every ${intervalMin} min)`);

let running = false;

async function tick() {
  if (running) {
    console.log('[cron] previous run still in progress, skipping');
    return;
  }
  running = true;
  try {
    const r = await runFullSync({});
    console.log(`[cron] tick ${r.ok ? 'OK' : 'FAIL'} ${r.durationMs}ms`);
    if (!r.ok) console.error('[cron] error:', r.error);
  } catch (e: any) {
    console.error('[cron] uncaught:', e?.message || e);
  } finally {
    running = false;
  }
}

cron.schedule(expr, tick);

// Один прогон сразу при старте
tick();

process.on('SIGINT', () => {
  console.log('[cron] SIGINT, exiting');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[cron] SIGTERM, exiting');
  process.exit(0);
});

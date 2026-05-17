// Долгоживущий cron-процесс: запускается отдельно от Next.js (npm run cron).
// Синхронизация каждые 30 минут с 09:00 до 23:30 по Asia/Almaty — ночью
// в 1С данные не меняются, гонять синк бессмысленно.
import cron from 'node-cron';
import { runFullSync } from './sync';

const timezone = process.env.TIMEZONE || 'Asia/Almaty';
const expr = '*/30 9-23 * * *';

console.log(`[cron] starting, schedule="${expr}" tz=${timezone}`);

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

cron.schedule(expr, tick, { timezone });

// Один прогон сразу при старте — но только если попадаем в рабочие часы.
const nowHour = Number(
  new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(new Date())
);
if (nowHour >= 9 && nowHour <= 23) {
  tick();
} else {
  console.log(`[cron] startup at ${nowHour}h ${timezone} — вне рабочих часов, ждём ближайший тик`);
}

process.on('SIGINT', () => {
  console.log('[cron] SIGINT, exiting');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[cron] SIGTERM, exiting');
  process.exit(0);
});

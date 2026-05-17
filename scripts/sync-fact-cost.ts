// One-shot: загрузить factCost из 1С-регистра для всех реализаций с янв.2026.
import { syncFactCost } from '../src/lib/sync/fact-cost';

async function main() {
  const args = process.argv.slice(2);
  const from = args[0] ? new Date(args[0]) : new Date('2026-01-01T00:00:00.000Z');
  const to   = args[1] ? new Date(args[1]) : new Date('2026-05-01T00:00:00.000Z');
  console.log(`Sync factCost: ${from.toISOString().slice(0,10)} .. ${to.toISOString().slice(0,10)}`);
  const stats = await syncFactCost(from, to);
  console.log('Stats:', stats);
  console.log(`  Realiz: ${stats.realizCostTotal.toLocaleString('ru-RU',{maximumFractionDigits:0})} ₸ (${stats.realizationsUpdated} док)`);
  console.log(`  WriteOff: ${stats.writeOffCostTotal.toLocaleString('ru-RU',{maximumFractionDigits:0})} ₸ (${stats.writeOffsUpdated} док)`);
}
main().catch(e => { console.error(e); process.exit(1); });

// Сверка наших ОПиУ с эталоном финансиста за окт.25–апр.26.
// Эталонные цифры — из memory financist-pnl-april2026-reference.md.
import { buildOpiu } from '../src/lib/reports/opiu';

type RowMap = Record<string, Record<string, number>>;

// Эталон финансиста: id строки → { 'YYYY-MM' → значение со знаком как у нас в отчёте (расход = отрицательное) }
const REF: RowMap = {
  // Помесячные обязательные
  fin_revenue_net: {
    '2025-10': 140_124_432, '2025-11': 192_791_475, '2025-12': 207_760_467,
    '2026-01': 219_834_213, '2026-02': 259_899_628, '2026-03': 267_625_131,
    '2026-04': 198_200_750,
  },
  fin_var_cogs: {
    '2025-10': -118_841_631, '2025-11': -162_482_911, '2025-12': -173_887_780,
    '2026-01': -180_038_212, '2026-02': -214_821_012, '2026-03': -219_794_215,
    '2026-04': -164_876_867,
  },
  fin_marginal: {
    '2025-10': 18_509_231, '2025-11': 26_667_830, '2025-12': 30_020_963,
    '2026-01': 35_938_151, '2026-02': 40_584_531, '2026-03': 40_226_270,
    '2026-04': 27_834_563,
  },
  fin_ebitda: {
    '2025-10': 13_162_500, '2025-11': 20_921_163, '2025-12': 24_337_235,
    '2026-01': 28_218_172, '2026-02': 30_237_258, '2026-03': 32_034_465,
    '2026-04': 20_531_990,
  },
  // Апрель — детальная сверка
  fin_amortization: { '2026-04': -429_597 },
  fin_gross_dir: { '2026-04': 26_775_893 },
  fin_gross: { '2026-04': 24_991_048 },
  fin_admin_total: { '2026-04': -3_333_648 },
  fin_commercial_total: { '2026-04': -1_125_410 },
  fin_overhead_total: { '2026-04': -1_784_845 },
  fin_direct_fixed_total: { '2026-04': -1_058_670 },
  fin_net: { '2026-04': 20_059_188 },
};

// Артикулы ДДС, по которым есть конкретные эталоны на апрель (значения со знаком "у нас")
const REF_ARTICLES_APR: Record<string, number> = {
  '1.14': -20_522, '1.15': -58_500,
  '1.18': -18_250, '1.19': -93_000, '1.20': -44_190, '1.21': -896_950, '1.23': -6_280,
  '1.08': -144_000, '1.12': -84_239, '1.13': -1_950, '1.17': -64_550, '1.22': -17_275,
  '1.24': -30_645, '1.25': -20_000, '1.26': -14_000, '1.27': -83_100, '1.30': -234_210,
  '1.31': -35_753, '1.33': -224_415, '1.34': -15_000, '1.35': -72_700, '1.36': -5_186,
  '1.37': -83_300, '1.38': -43_205, '1.41': +52_635,
  // Аренда — финансист 0 (учитывается accrual'ом)
  '1.06': 0, '1.07': 0,
  // ЗП — финансист use accrual, мы — выплаты ДДС. Сравним всё равно, чтобы видеть Δ.
  '1.09': -967_000, '1.10': -450_000, '1.11': -2_435_000,
};

function fmt(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—'.padStart(14);
  const s = Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
  return s.padStart(14);
}
function pctDiff(ours: number, ref: number): string {
  if (ref === 0) return ours === 0 ? '   0%' : ' n/a';
  const d = ((ours - ref) / Math.abs(ref)) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`.padStart(7);
}

async function run() {
  const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'];
  // Один вызов buildOpiu сразу за весь диапазон
  const report = await buildOpiu({
    from: new Date('2025-10-01'),
    to: new Date('2026-04-30'),
    granularity: 'month',
    view: 'financist',
  });
  const rowsById = new Map<string, any>();
  for (const r of report.rows) rowsById.set(r.id, r);

  console.log('\n══════════════════ ОБЩИЕ СТРОКИ (окт.25 — апр.26) ══════════════════\n');
  const rowOrder = ['fin_revenue_net', 'fin_var_cogs', 'fin_marginal', 'fin_ebitda'];
  for (const id of rowOrder) {
    const row = rowsById.get(id);
    if (!row) { console.log(`[${id}] не найдена в отчёте`); continue; }
    console.log(`▶ ${row.label}  (id=${id})`);
    console.log('  Месяц    │      Финансист │            Наши │      Δ │     Δ%');
    console.log('  ─────────┼────────────────┼─────────────────┼────────┼────────');
    for (const m of months) {
      const ours = row.values?.[m] ?? 0;
      const ref = REF[id]?.[m];
      if (ref === undefined) {
        console.log(`  ${m}  │${fmt(ref)} │ ${fmt(ours)} │   —    │   —`);
      } else {
        const delta = ours - ref;
        console.log(`  ${m}  │${fmt(ref)} │ ${fmt(ours)} │${fmt(delta)} │ ${pctDiff(ours, ref)}`);
      }
    }
    console.log();
  }

  console.log('\n══════════════════ АПРЕЛЬ 2026 — ДЕТАЛЬНАЯ СВЕРКА АГРЕГАТОВ ══════════════════\n');
  const aprAggregates = [
    'fin_revenue_net', 'fin_var_cogs', 'fin_marginal',
    'fin_direct_fixed_total', 'fin_gross_dir',
    'fin_overhead_total', 'fin_gross',
    'fin_admin_total', 'fin_commercial_total',
    'fin_ebitda', 'fin_amortization', 'fin_net',
  ];
  console.log(`  ${'Строка'.padEnd(45)} │      Финансист │            Наши │      Δ │     Δ%`);
  console.log(`  ${'─'.repeat(45)} ┼────────────────┼─────────────────┼────────┼────────`);
  for (const id of aprAggregates) {
    const row = rowsById.get(id);
    const ours = row?.values?.['2026-04'] ?? 0;
    const ref = REF[id]?.['2026-04'];
    if (ref === undefined) continue;
    const delta = ours - ref;
    console.log(`  ${(row?.label ?? id).padEnd(45)} │${fmt(ref)} │ ${fmt(ours)} │${fmt(delta)} │ ${pctDiff(ours, ref)}`);
  }

  console.log('\n══════════════════ АПРЕЛЬ 2026 — ПО АРТИКУЛАМ ДДС ══════════════════\n');
  console.log(`  ${'Артикул'.padEnd(45)} │      Финансист │            Наши │      Δ │     Δ%`);
  console.log(`  ${'─'.repeat(45)} ┼────────────────┼─────────────────┼────────┼────────`);
  const articleEntries = Object.entries(REF_ARTICLES_APR).sort((a, b) => parseFloat(a[0].slice(2)) - parseFloat(b[0].slice(2)));
  let totalRefAccountable = 0;
  let totalOursAccountable = 0;
  for (const [code, ref] of articleEntries) {
    const row = rowsById.get(`article:${code}`);
    const ours = row?.values?.['2026-04'] ?? 0;
    const delta = ours - ref;
    const label = row?.label ?? code;
    console.log(`  ${label.padEnd(45)} │${fmt(ref)} │ ${fmt(ours)} │${fmt(delta)} │ ${pctDiff(ours, ref)}`);
    totalRefAccountable += ref;
    totalOursAccountable += ours;
  }
  console.log(`  ${'─'.repeat(45)} ┼────────────────┼─────────────────┼────────┼────────`);
  console.log(`  ${'ИТОГО по артикулам выше'.padEnd(45)} │${fmt(totalRefAccountable)} │ ${fmt(totalOursAccountable)} │${fmt(totalOursAccountable - totalRefAccountable)} │ ${pctDiff(totalOursAccountable, totalRefAccountable)}`);

  // Покажем какие fin_article_ строки есть у нас, но нет в эталоне (или ненулевые без эталона)
  console.log('\n══════════════════ НАШИ fin_article_ СТРОКИ БЕЗ ЭТАЛОНА (апр.26) ══════════════════\n');
  const allArticleRows = report.rows.filter((r: any) => r.id?.startsWith('article:'));
  for (const row of allArticleRows) {
    const code = row.id.replace('article:', '');
    if (REF_ARTICLES_APR[code] !== undefined) continue;
    const val = row.values?.['2026-04'] ?? 0;
    if (Math.abs(val) < 0.5) continue;
    console.log(`  ${row.label.padEnd(60)} │ ${fmt(val)}`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });

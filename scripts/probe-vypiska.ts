// Проверка готового модуля сверки на реальном файле.
import { readFileSync } from 'fs';
import { reconcileVypiska } from '@/lib/reports/vypiska-recon';

const FILE = process.env.STMT_FILE || 'Выписка_по_счету_KZ88722S000032116995.xlsx';

async function main() {
  const buf = readFileSync(FILE);
  const r = await reconcileVypiska(buf, FILE);
  console.log('Счёт:', r.account);
  console.log('Остатки:', r.balances);
  console.log('Сводка:', r.summary);
  console.log('Инфо:', { fees: r.info.fees, withdrawals: r.info.withdrawals, refunds: r.info.refunds, accountFees: r.info.accountFees, commissionRefunds: r.info.commissionRefunds, otherN: r.info.other.length });
  console.log('\nДни с расхождением / особым статусом:');
  for (const d of r.days) {
    if (d.status !== 'ok') console.log(`  ${d.date}  выписка=${d.statementSales}  1С=${d.oneCSum}  Δ=${d.diff}  [${d.status}]  (1С док: ${d.docs.length})`);
  }
  console.log(`\nВсего дней: ${r.days.length}, ОК: ${r.summary.daysOk}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('ОШИБКА:', e?.stack || e); process.exit(1); });

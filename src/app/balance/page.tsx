import { buildBalance } from '@/lib/reports/balance';
import BalanceClient from '@/components/BalanceClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { asOf?: string };
}

export default async function BalancePage({ searchParams }: Props) {
  const asOf = searchParams.asOf ? new Date(searchParams.asOf) : undefined;
  const report = await buildBalance({ asOf });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Баланс</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Управленческий баланс на {new Date(report.asOf).toLocaleString('ru-RU', { dateStyle: 'short' })}:
          активы (деньги, товары, дебиторка, ОС) и пассивы (кредиторка, авансы клиентов).
        </p>
      </div>
      <BalanceClient initial={report} />
    </div>
  );
}

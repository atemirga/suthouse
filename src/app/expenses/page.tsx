import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildExpenses } from '@/lib/reports/expenses';
import PeriodPicker from '@/components/PeriodPicker';
import ExpensesClient from '@/components/ExpensesClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function ExpensesPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const report = await buildExpenses({ from, to });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Структура расходов</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Все исходящие платежи по категориям ОПиУ. Кликните категорию, чтобы увидеть детализацию по статьям.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <ExpensesClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildOrdersByManager } from '@/lib/reports/orders-by-manager';
import PeriodPicker from '@/components/PeriodPicker';
import ManagersClient from '@/components/ManagersClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function ByManagerPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const report = await buildOrdersByManager({ from, to });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Заказы менеджеров</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Сводка по ответственным: заказы, отгрузки, выручка, прибыль, средний чек.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <ManagersClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

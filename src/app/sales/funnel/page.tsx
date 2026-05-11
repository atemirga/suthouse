import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildFunnel } from '@/lib/reports/funnel';
import PeriodPicker from '@/components/PeriodPicker';
import FunnelClient from '@/components/FunnelClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function FunnelPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const report = await buildFunnel({ from, to });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Воронка продаж</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          По источникам привлечения: контрагенты → с заказом → совершили продажу.
          В этой версии УНФ KZ модуль «Лиды» пуст, поэтому верхняя ступень — контрагенты с привязанным источником.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <FunnelClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

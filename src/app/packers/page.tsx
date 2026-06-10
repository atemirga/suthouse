import { startOfMonth, endOfMonth } from 'date-fns';
import { buildPackersReport } from '@/lib/reports/packers';
import { parsePeriodFrom, parsePeriodTo } from '@/lib/dates';
import PeriodPicker from '@/components/PeriodPicker';
import PackersClient from '@/components/PackersClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function PackersPage({ searchParams }: Props) {
  const from = searchParams.from ? parsePeriodFrom(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parsePeriodTo(searchParams.to) : endOfMonth(new Date());
  const report = await buildPackersReport({ from, to });

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Упаковщики</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Кто фактически отгрузил заказы. Считаем по расходным накладным; имя упаковщика берётся из доп.реквизита «Упаковщик» в Заказе покупателя.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <PackersClient
        initial={JSON.parse(JSON.stringify({
          ...report,
          from: report.from.toISOString(),
          to: report.to.toISOString(),
        }))}
      />
    </div>
  );
}

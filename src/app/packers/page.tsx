import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildPackers } from '@/lib/reports/packers';
import PeriodPicker from '@/components/PeriodPicker';
import PackersClient from '@/components/PackersClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function PackersPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const r = await buildPackers({ from, to });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Упаковщики ABC</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Сборщики/упаковщики заказов покупателей. В этой 1С это поле «Курьер» в заказе.
          ABC — A: до 80% оборота, B: 80–95%, C: остальное.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <PackersClient initial={JSON.parse(JSON.stringify({
        ...r,
        from: r.from.toISOString(),
        to: r.to.toISOString(),
      }))} />
    </div>
  );
}

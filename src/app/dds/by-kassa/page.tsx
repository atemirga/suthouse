import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildDdsByKassa } from '@/lib/reports/dds-by-kassa';
import PeriodPicker from '@/components/PeriodPicker';
import KassaClient from '@/components/KassaClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function DdsByKassaPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const report = await buildDdsByKassa({ from, to });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ДДС по кассам и счетам</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Остатки и обороты по каждой кассе и банковскому счёту. Перемещения учитываются как в 1С ДДС-Касса.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <KassaClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

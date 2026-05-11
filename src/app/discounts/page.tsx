import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildDiscounts } from '@/lib/reports/discounts';
import PeriodPicker from '@/components/PeriodPicker';
import DiscountsClient from '@/components/DiscountsClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function DiscountsPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const report = await buildDiscounts({ from, to });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Скидки выданные</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Все скидки в реализациях за период. Источник — поле «СуммаСкидкиНаценки» в позициях документов.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <DiscountsClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

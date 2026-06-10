import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO, subMonths } from 'date-fns';
import Link from 'next/link';
import { buildXyz, type XyzParam } from '@/lib/reports/xyz';
import PeriodPicker from '@/components/PeriodPicker';
import XyzClient from '@/components/XyzClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string; param?: string };
}

export default async function XyzPage({ searchParams }: Props) {
  // По умолчанию — 3 предыдущих полных месяца + текущий. Иначе при выборе
  // 1 месяца singleMonth=true → ВСЕ SKU автоматически становятся Z, а X/Y
  // показывают 0. Для XYZ нужен ≥ 2 месяца, в идеале 3-6.
  const from = searchParams.from
    ? startOfDay(parseISO(searchParams.from))
    : startOfMonth(subMonths(new Date(), 2));
  const to = searchParams.to ? endOfDay(parseISO(searchParams.to)) : endOfMonth(new Date());
  const param = (searchParams.param as XyzParam) || 'revenue';
  const report = await buildXyz({ from, to, param });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">XYZ-анализ номенклатуры</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Стабильность спроса по коэффициенту вариации помесячных продаж.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/sales/abc"
          className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50"
        >
          ABC-анализ
        </Link>
        <Link
          href="/sales/xyz"
          className="px-3 py-1.5 rounded-lg border border-brand-500 bg-brand-50 text-sm text-brand-700 font-semibold"
        >
          XYZ-анализ
        </Link>
      </div>
      <PeriodPicker showGranularity={false} />
      <XyzClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

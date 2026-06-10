import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import Link from 'next/link';
import { buildAbc, type AbcParam } from '@/lib/reports/abc';
import PeriodPicker from '@/components/PeriodPicker';
import AbcClient from '@/components/AbcClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string; param?: string };
}

export default async function AbcPage({ searchParams }: Props) {
  const from = searchParams.from ? startOfDay(parseISO(searchParams.from)) : startOfMonth(new Date());
  const to = searchParams.to ? endOfDay(parseISO(searchParams.to)) : endOfMonth(new Date());
  const param = (searchParams.param as AbcParam) || 'revenue';
  const report = await buildAbc({ from, to, param });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ABC-анализ номенклатуры</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Парето 80/15/5 по выручке, прибыли или массе (кг). Себестоимость согласована с фактом 1С.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/sales/abc"
          className="px-3 py-1.5 rounded-lg border border-brand-500 bg-brand-50 text-sm text-brand-700 font-semibold"
        >
          ABC-анализ
        </Link>
        <Link
          href="/sales/xyz"
          className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50"
        >
          XYZ-анализ
        </Link>
      </div>
      <PeriodPicker showGranularity={false} />
      <AbcClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

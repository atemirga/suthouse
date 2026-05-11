import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildAbc, type AbcParam } from '@/lib/reports/abc';
import PeriodPicker from '@/components/PeriodPicker';
import AbcClient from '@/components/AbcClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string; param?: string };
}

export default async function AbcPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const param = (searchParams.param as AbcParam) || 'revenue';
  const report = await buildAbc({ from, to, param });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ABC-анализ номенклатуры</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Парето 80/15/5 — что приносит основные деньги. Класс A = 80% выручки, B = 15%, C = 5%.
        </p>
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

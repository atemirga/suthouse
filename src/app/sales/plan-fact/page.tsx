import { buildPlanFact } from '@/lib/reports/plan-fact';
import PlanFactClient from '@/components/PlanFactClient';

export const dynamic = 'force-dynamic';

export default async function PlanFactPage() {
  const report = await buildPlanFact();
  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">План-фактный анализ</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Сравнение установленных планов с фактическими реализациями. Прогноз — линейная экстраполяция к концу периода.
        </p>
      </div>
      <PlanFactClient initial={JSON.parse(JSON.stringify({
        ...report,
        rows: report.rows.map((r) => ({
          ...r,
          startDate: r.startDate.toISOString(),
          endDate: r.endDate.toISOString(),
        })),
      }))} />
    </div>
  );
}

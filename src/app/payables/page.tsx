import { buildPayables } from '@/lib/reports/payables';
import { AGING_BUCKETS } from '@/lib/reports/receivables';
import { format } from 'date-fns';
import PayablesClient from '@/components/PayablesClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { asOf?: string };
}

export default async function PayablesPage({ searchParams }: Props) {
  const asOf = searchParams.asOf ? new Date(searchParams.asOf) : new Date();
  const report = await buildPayables({ asOf });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Кредиторская задолженность</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          На {format(report.asOf, 'dd.MM.yyyy')} · {report.totals.creditorCount} поставщиков · сколько мы должны
        </p>
      </div>
      <PayablesClient
        initialData={JSON.parse(JSON.stringify({
          ...report,
          asOf: report.asOf.toISOString(),
          rows: report.rows.map((r) => ({ ...r, oldestDate: r.oldestDate?.toISOString() || null })),
        }))}
        bucketDefs={AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, color: b.color }))}
      />
    </div>
  );
}

import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildPayments, listKassasAndAccounts } from '@/lib/reports/payments';
import PeriodPicker from '@/components/PeriodPicker';
import PaymentsClient from '@/components/PaymentsClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string; direction?: string; kassaId?: string; accountId?: string; q?: string };
}

export default async function PaymentsPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const [report, refs] = await Promise.all([
    buildPayments({
      from, to,
      direction: (searchParams.direction as any) || 'all',
      kassaId: searchParams.kassaId || undefined,
      accountId: searchParams.accountId || undefined,
      search: searchParams.q || undefined,
      limit: 500,
    }),
    listKassasAndAccounts(),
  ]);

  return (
    <div className="space-y-5 max-w-[1800px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Реестр платежей</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Все банковские и кассовые движения. Показано до 500 последних записей по фильтру.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <PaymentsClient
        initial={JSON.parse(JSON.stringify({
          ...report,
          from: report.from.toISOString(),
          to: report.to.toISOString(),
          rows: report.rows.map((r) => ({ ...r, date: r.date.toISOString() })),
        }))}
        kassas={refs.kassas}
        banks={refs.banks}
      />
    </div>
  );
}

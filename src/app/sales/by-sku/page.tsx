import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildSalesBySku } from '@/lib/reports/sales-by-sku';
import PeriodPicker from '@/components/PeriodPicker';
import SkuPivotClient from '@/components/SkuPivotClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function SalesBySkuPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const report = await buildSalesBySku({ from, to, limit: 200 });

  return (
    <div className="space-y-5 max-w-[1800px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Продажи по SKU и менеджерам</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Кросс-таблица: позиция × менеджер. Показаны топ-200 позиций по выручке.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <SkuPivotClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

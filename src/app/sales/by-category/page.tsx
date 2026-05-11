import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildSalesByCategory } from '@/lib/reports/sales-by-category';
import PeriodPicker from '@/components/PeriodPicker';
import CategoryTreeClient from '@/components/CategoryTreeClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string };
}

export default async function SalesByCategoryPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const report = await buildSalesByCategory({ from, to });

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Продажи по категориям</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Иерархия категорий номенклатуры. Кликните на категорию, чтобы развернуть подкатегории и SKU.
        </p>
      </div>
      <PeriodPicker showGranularity={false} />
      <CategoryTreeClient initial={JSON.parse(JSON.stringify({
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
      }))} />
    </div>
  );
}

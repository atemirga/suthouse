import { buildInventory, listWarehouses } from '@/lib/reports/inventory';
import InventoryClient from '@/components/InventoryClient';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { warehouseId?: string };
}

export default async function InventoryPage({ searchParams }: Props) {
  const [report, warehouses] = await Promise.all([
    buildInventory({ warehouseId: searchParams.warehouseId }),
    listWarehouses(),
  ]);

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Остатки товаров</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Снимок из регистра 1С «Запасы на складах».
          {report.asOfDate && (
            <> На {new Date(report.asOfDate).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}.</>
          )}
        </p>
      </div>
      <InventoryClient
        initial={JSON.parse(JSON.stringify({
          ...report,
          asOfDate: report.asOfDate?.toISOString() || null,
        }))}
        warehouses={warehouses}
      />
    </div>
  );
}

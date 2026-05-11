import { prisma } from '@/lib/db';
import AdjustmentsClient from '@/components/AdjustmentsClient';

export const dynamic = 'force-dynamic';

export default async function AdjustmentsPage() {
  const items = await prisma.manualAdjustment.findMany({ orderBy: { createdAt: 'desc' } });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Ручные корректировки ОПиУ</h1>
      <p className="text-sm text-gray-600">
        Добавьте суммы (положительные или отрицательные) к категориям ОПиУ в конкретном месяце.
      </p>
      <AdjustmentsClient items={items} />
    </div>
  );
}

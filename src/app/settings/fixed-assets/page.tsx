import { prisma } from '@/lib/db';
import FixedAssetsClient from '@/components/FixedAssetsClient';

export const dynamic = 'force-dynamic';

export default async function FixedAssetsPage() {
  const items = await prisma.fixedAsset.findMany({ orderBy: { startDate: 'desc' } });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Основные средства</h1>
      <p className="text-sm text-gray-600">
        Линейная амортизация: ежемесячно стоимость / срок полезного использования включается в ОПиУ.
      </p>
      <FixedAssetsClient items={items.map((i) => ({ ...i, startDate: i.startDate.toISOString().slice(0, 10) }))} />
    </div>
  );
}

import { prisma } from '@/lib/db';
import PlansClient from '@/components/PlansClient';

export const dynamic = 'force-dynamic';

export default async function PlansPage() {
  const [plans, employees, categories] = await Promise.all([
    prisma.salesPlan.findMany({ orderBy: { startDate: 'desc' } }),
    prisma.employee.findMany({ where: { isFolder: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.nomenclature.findMany({ where: { isFolder: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Планы продаж</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Установка целевых планов: всего, по категориям, по менеджерам. Сравнение с фактом — на странице «План-факт».
        </p>
      </div>
      <PlansClient
        initial={JSON.parse(JSON.stringify(plans.map((p) => ({
          ...p,
          startDate: p.startDate.toISOString(),
          endDate: p.endDate.toISOString(),
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }))))}
        employees={employees}
        categories={categories}
      />
    </div>
  );
}

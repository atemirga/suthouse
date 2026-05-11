import { prisma } from '@/lib/db';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildDashboard } from '@/lib/reports/dashboard';
import PeriodPicker from '@/components/PeriodPicker';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { from?: string; to?: string; granularity?: string };
}

export default async function DashboardPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const granularity = (searchParams.granularity as any) || 'month';

  const [data, lastSync, unmappedCount] = await Promise.all([
    buildDashboard({ from, to, granularity }),
    prisma.syncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.ddsArticle.count({ where: { opiuCategory: null, isFolder: false } }),
  ]);

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Дашборд</h1>
          <p className="text-sm text-gray-500 mt-0.5">Сводка ключевых показателей и динамика бизнеса</p>
        </div>
      </div>
      <PeriodPicker />
      <Dashboard
        initialData={JSON.parse(JSON.stringify(data))}
        lastSync={lastSync ? {
          status: lastSync.status,
          finishedAt: lastSync.finishedAt?.toISOString() || null,
          startedAt: lastSync.startedAt.toISOString(),
        } : null}
        unmappedCount={unmappedCount}
      />
    </div>
  );
}

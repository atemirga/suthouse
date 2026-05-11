import { prisma } from '@/lib/db';
import MappingClient from '@/components/MappingClient';

export const dynamic = 'force-dynamic';

export default async function MappingPage() {
  // Подтягиваем оборот по каждой статье (чтобы пользователь видел приоритет)
  const [articles, turnover] = await Promise.all([
    prisma.ddsArticle.findMany({
      orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
    }),
    prisma.ddsDocument.groupBy({
      by: ['articleId'],
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  const turnoverMap = new Map(turnover.map((t: any) => [t.articleId, { amount: t._sum.amount || 0, count: t._count }]));

  const enriched = articles.map((a) => {
    const t = turnoverMap.get(a.id);
    return {
      id: a.id,
      name: a.name,
      isFolder: a.isFolder,
      opiuCategory: a.opiuCategory,
      ddsSection: a.ddsSection,
      turnover: t?.amount || 0,
      docCount: t?.count || 0,
    };
  });

  const unmapped = enriched.filter((a) => !a.isFolder && !a.opiuCategory).length;
  const totalTurnover = enriched.reduce((s, a) => s + a.turnover, 0);
  const unmappedTurnover = enriched.filter((a) => !a.isFolder && !a.opiuCategory).reduce((s, a) => s + a.turnover, 0);

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Маппинг статей ДДС</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Каждая статья ДДС из 1С должна быть привязана к категории ОПиУ — иначе расходы не учтутся в отчёте о прибылях.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card"><div className="kpi-label">Всего статей</div><div className="kpi-value text-xl">{enriched.filter((a) => !a.isFolder).length}</div></div>
        <div className="kpi-card"><div className="kpi-label">Без категории</div><div className={'kpi-value text-xl ' + (unmapped > 0 ? 'text-amber-600' : 'text-green-600')}>{unmapped}</div></div>
        <div className="kpi-card"><div className="kpi-label">Общий оборот</div><div className="kpi-value text-xl">{(totalTurnover/1e6).toFixed(0)} <span className="text-sm text-gray-500">млн ₸</span></div></div>
        <div className="kpi-card"><div className="kpi-label">В неразмеченных</div><div className={'kpi-value text-xl ' + (unmappedTurnover > 0 ? 'text-amber-600' : 'text-green-600')}>{(unmappedTurnover/1e6).toFixed(0)} <span className="text-sm text-gray-500">млн ₸</span></div></div>
      </div>

      <MappingClient articles={enriched} />
    </div>
  );
}

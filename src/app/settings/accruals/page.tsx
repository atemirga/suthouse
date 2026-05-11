import { prisma } from '@/lib/db';
import AccrualsClient from '@/components/AccrualsClient';

export const dynamic = 'force-dynamic';

export default async function AccrualsPage() {
  const [rules, articles] = await Promise.all([
    prisma.accrualRule.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.ddsArticle.findMany({
      where: { isFolder: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const map = new Map(articles.map((a) => [a.id, a.name]));
  const enriched = rules.map((r) => ({ ...r, articleName: map.get(r.articleId) || r.articleId }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Правила распределения (Accrual)</h1>
      <p className="text-sm text-gray-600">
        Сумма документа по выбранной статье будет размазана на N месяцев в ОПиУ.
      </p>
      <AccrualsClient rules={enriched} articles={articles} />
    </div>
  );
}

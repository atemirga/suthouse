import PeriodPicker from '@/components/PeriodPicker';
import DdsTable from '@/components/DdsTable';
import DdsFiltersBar from '@/components/DdsFiltersBar';
import ExportButton from '@/components/ExportButton';
import { buildDds } from '@/lib/reports/dds';
import { prisma } from '@/lib/db';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: {
    from?: string;
    to?: string;
    granularity?: string;
    kassa?: string;
    account?: string;
    article?: string;
    kontragent?: string;
    q?: string;
  };
}

export default async function DdsPage({ searchParams }: Props) {
  const from = searchParams.from ? parseISO(searchParams.from) : startOfMonth(new Date());
  const to = searchParams.to ? parseISO(searchParams.to) : endOfMonth(new Date());
  const granularity = (searchParams.granularity as any) || 'month';

  const [report, kassy, banks, articles] = await Promise.all([
    buildDds({
      from,
      to,
      granularity,
      kassaIds: searchParams.kassa?.split(',').filter(Boolean),
      accountIds: searchParams.account?.split(',').filter(Boolean),
      articleIds: searchParams.article?.split(',').filter(Boolean),
      kontragentIds: searchParams.kontragent?.split(',').filter(Boolean),
      search: searchParams.q,
    }),
    prisma.kassa.findMany({ orderBy: { name: 'asc' } }),
    prisma.bankAccount.findMany({ orderBy: { name: 'asc' } }),
    prisma.ddsArticle.findMany({ where: { isFolder: false }, orderBy: { name: 'asc' } }),
  ]);

  // Статистика статей: общее, использовано в периоде, без маппинга
  const articlesUsed = new Set(report.rows.map((r) => r.articleId).filter(Boolean));
  const totalArticles = articles.length;
  const articlesUsedCount = articlesUsed.size;
  const unmappedArticles = articles.filter((a) => !a.opiuCategory).length;
  const unmappedUsed = articles.filter((a) => articlesUsed.has(a.id) && !a.opiuCategory).length;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ДДС — Движение денежных средств</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Кассовый метод · реальные деньги по операционной, инвестиционной и финансовой деятельности
          </p>
        </div>
        <ExportButton endpoint="/api/export/dds" />
      </div>
      <PeriodPicker />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Всего статей в 1С</div>
          <div className="kpi-value text-xl">{totalArticles}</div>
          <div className="text-xs text-gray-500 mt-0.5">справочник «Статьи ДДС»</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Использовано в периоде</div>
          <div className="kpi-value text-xl text-brand-700">{articlesUsedCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {totalArticles > 0 ? ((articlesUsedCount / totalArticles) * 100).toFixed(0) + '%' : '—'} от всех
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Без категории ОПиУ</div>
          <div className={'kpi-value text-xl ' + (unmappedArticles > 0 ? 'text-amber-600' : 'text-green-600')}>{unmappedArticles}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {unmappedUsed > 0
              ? <>из них активны: <a href="/settings/mapping" className="text-amber-700 underline font-medium">{unmappedUsed}</a></>
              : 'все важные размечены'}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Строк в отчёте</div>
          <div className="kpi-value text-xl">{report.rows.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">по разделам и направлениям</div>
        </div>
      </div>

      <DdsFiltersBar kassy={kassy} banks={banks} articles={articles} />
      <div className="panel">
        <DdsTable report={report} />
      </div>

      <details className="panel p-4 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Как читать ДДС</summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>
            <b>Операционная деятельность</b> — поступления и платежи от текущей деятельности
            (выручка, оплата поставщикам, ФОТ, аренда, налоги).
          </p>
          <p>
            <b>Инвестиционная</b> — покупка/продажа основных средств и долгосрочных активов.
          </p>
          <p>
            <b>Финансовая</b> — кредиты, займы, проценты, выплаты собственникам (дивиденды).
          </p>
          <p>
            <b>Чистый денежный поток</b> — сумма всех трёх разделов. Это реальное изменение
            остатка денежных средств за период.
          </p>
          <p>
            Перемещения между кассами/счетами в отчёт не попадают — это не движение денег
            «из бизнеса», а внутреннее перекладывание.
          </p>
        </div>
      </details>
    </div>
  );
}

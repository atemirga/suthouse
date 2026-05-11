import { buildAnomalies } from '@/lib/reports/anomalies';
import { format } from 'date-fns';
import { IconWarning, IconInfo } from '@/components/Icons';

export const dynamic = 'force-dynamic';

function fmt(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

const SEVERITY_STYLES: Record<string, { bar: string; text: string; bg: string; label: string }> = {
  high: { bar: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50 border-red-200', label: 'Высокий' },
  medium: { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', label: 'Средний' },
  low: { bar: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50 border-gray-200', label: 'Низкий' },
};

export default async function AnomaliesPage() {
  const report = await buildAnomalies();
  const high = report.categories.filter((c) => c.severity === 'high' && c.count > 0).length;
  const medium = report.categories.filter((c) => c.severity === 'medium' && c.count > 0).length;
  const totalAffectedAmount = report.categories.reduce((s, c) => s + (c.totalAmount || 0), 0);

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <IconWarning className="text-amber-600" /> Аномалии и подозрительные документы
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Автоматический аудит данных из 1С: ошибки ввода, опечатки в датах, нестыковки маппинга, неожиданные результаты FIFO.
          Регенерируется при каждом открытии страницы.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Всего проблем</div>
          <div className={'kpi-value text-2xl ' + (report.totalIssues > 0 ? 'text-amber-600' : 'text-green-600')}>
            {report.totalIssues}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">по {report.categories.length} категориям</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Высокая важность</div>
          <div className={'kpi-value text-2xl ' + (high > 0 ? 'text-red-600' : 'text-green-600')}>{high}</div>
          <div className="text-xs text-gray-500 mt-0.5">категорий с критичными проблемами</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Средняя важность</div>
          <div className={'kpi-value text-2xl ' + (medium > 0 ? 'text-amber-600' : 'text-green-600')}>{medium}</div>
          <div className="text-xs text-gray-500 mt-0.5">категорий с заметным влиянием</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Затронутые суммы</div>
          <div className="kpi-value text-xl">{fmt(totalAffectedAmount)} <span className="text-sm text-gray-500">₸</span></div>
          <div className="text-xs text-gray-500 mt-0.5">в сумме по всем аномалиям</div>
        </div>
      </div>

      <div className="hint">
        <IconInfo className="hint-icon" />
        <div className="text-sm">
          <b>Как использовать.</b> Это «список TODO» для качества данных. Большая часть фиксится в 1С (исправляйте даты, проставляйте статьи ДДС
          и контрагентов), маппинг статей делается тут на странице{' '}
          <a href="/settings/mapping" className="text-brand-600 underline">Настройки → Маппинг</a>. После исправления в 1С при следующей синхронизации
          (каждые 15 мин) запись здесь исчезнет автоматически.
        </div>
      </div>

      <div className="space-y-3">
        {report.categories.map((cat) => {
          const sev = SEVERITY_STYLES[cat.severity];
          const empty = cat.count === 0;
          return (
            <details
              key={cat.key}
              className={'panel border-l-4 ' + (empty ? 'border-l-green-400' : sev.bar.replace('bg-', 'border-l-'))}
            >
              <summary className="cursor-pointer px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 flex items-center gap-2">
                    {cat.title}
                    <span className={'text-xs px-2 py-0.5 rounded font-normal ' + (empty ? 'bg-green-100 text-green-700' : sev.bg + ' ' + sev.text)}>
                      {empty ? 'OK' : sev.label}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{cat.description}</div>
                </div>
                <div className="flex items-center gap-4 text-right">
                  {cat.totalAmount !== undefined && cat.totalAmount > 0 && (
                    <div>
                      <div className="text-xs text-gray-500">Сумма</div>
                      <div className="font-mono text-sm">{fmt(cat.totalAmount)} ₸</div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs text-gray-500">Найдено</div>
                    <div className={'text-2xl font-bold ' + (empty ? 'text-green-600' : sev.text)}>{cat.count}</div>
                  </div>
                </div>
              </summary>

              {cat.count > 0 && (
                <div className="border-t border-gray-200 overflow-auto">
                  <table className="report">
                    <thead>
                      <tr>
                        <th className="w-32">Дата</th>
                        <th className="w-32">Номер</th>
                        <th className="text-right w-32">Сумма</th>
                        <th>Детали</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.docs.map((d, i) => (
                        <tr key={cat.key + ':' + i} className="hover:bg-gray-50">
                          <td className="text-xs text-gray-700">
                            {d.date ? format(d.date, 'dd.MM.yyyy') : '—'}
                          </td>
                          <td className="font-mono text-xs">
                            {d.link ? <a href={d.link} className="text-brand-600 hover:underline">{d.number || '—'}</a> : (d.number || '—')}
                          </td>
                          <td className="text-right font-mono text-xs">
                            {d.amount !== null && d.amount !== undefined ? fmt(d.amount) : '—'}
                          </td>
                          <td className="text-xs text-gray-600">{d.detail || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {cat.truncated && (
                    <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-t border-gray-200">
                      Показаны первые 100 записей из {cat.count}. Остальное скрыто.
                    </div>
                  )}
                </div>
              )}
            </details>
          );
        })}
      </div>

      <div className="text-xs text-gray-400 text-right">
        Сгенерировано: {format(report.generatedAt, 'dd.MM.yyyy HH:mm:ss')}
      </div>
    </div>
  );
}

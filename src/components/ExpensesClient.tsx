'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PieBreakdown } from './Charts';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { IconChevronDown } from './Icons';
import { format } from 'date-fns';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
};

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#a855f7', '#14b8a6', '#94a3b8'];

interface DocRow {
  id: string;
  date: string;
  number: string;
  counterparty?: string | null;
  article?: string | null;
  amount: number;
  comment?: string | null;
}

export default function ExpensesClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [drill, setDrill] = useState<{ label: string; category: string; article?: string; docs: DocRow[] } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/expenses?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function toggle(c: string) {
    const n = new Set(opened);
    if (n.has(c)) n.delete(c);
    else n.add(c);
    setOpened(n);
  }

  async function openDrill(category: string, label: string, article?: string) {
    setDrillLoading(true);
    setDrill({ category, label, article, docs: [] });
    try {
      const p = new URLSearchParams(sp.toString());
      p.set('drill', category);
      if (article) p.set('article', article);
      const r = await fetch('/api/expenses?' + p.toString());
      const d = await r.json();
      setDrill({ category, label, article, docs: d.docs || [] });
    } finally {
      setDrillLoading(false);
    }
  }

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r: any) =>
      r.label.toLowerCase().includes(q) ||
      r.articles.some((a: any) => a.name.toLowerCase().includes(q)) ||
      r.topKontragenty.some((k: any) => k.name.toLowerCase().includes(q)),
    );
  }, [data, search]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  // ── Pie данные ──
  const pieData = data.rows.map((r: any) => ({ name: r.label, value: r.amount }));

  // ── Тренд: bar chart по месяцам, стак по топ-5 категориям ──
  const topCategoryKeys: string[] = data.categoriesOrder.slice(0, 5);
  const labelByCat: Record<string, string> = {};
  for (const r of data.rows) labelByCat[r.category] = r.label;
  const trendData = data.monthlyTrend.map((m: any) => {
    const row: Record<string, any> = { label: m.label, total: m.total };
    let topSum = 0;
    for (const k of topCategoryKeys) {
      row[k] = m.byCategory[k] || 0;
      topSum += row[k];
    }
    row['_other'] = Math.max(0, m.total - topSum);
    return row;
  });

  const deltaArrow = data.delta > 0 ? '↑' : data.delta < 0 ? '↓' : '→';
  const deltaColor = data.delta > 0 ? 'text-rose-700' : data.delta < 0 ? 'text-emerald-700' : 'text-gray-500';

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiBlock
          label="Расходы за период"
          value={fmtCompact(data.total)}
          suffix="₸"
          sub={`${data.daysInPeriod} дн · ${data.docCount} док`}
        />
        <KpiBlock
          label="Прошлый период"
          value={fmtCompact(data.prevTotal)}
          suffix="₸"
          sub={`${data.prevDocCount} док`}
        />
        <KpiBlock
          label="Изменение"
          value={`${deltaArrow} ${fmtCompact(Math.abs(data.delta))}`}
          suffix="₸"
          sub={data.prevTotal > 0 ? `${data.deltaPct > 0 ? '+' : ''}${data.deltaPct.toFixed(1)}%` : 'нет базы'}
          colorClass={deltaColor}
        />
        <KpiBlock
          label="Средн. в день"
          value={fmtCompact(data.avgPerDay)}
          suffix="₸/день"
        />
        <KpiBlock
          label="Главная статья"
          value={data.biggestCategory?.label || '—'}
          sub={data.biggestCategory ? `${data.biggestCategory.share.toFixed(1)}% от итога` : ''}
        />
      </div>

      {/* Период сравнения info */}
      <div className="panel p-3 text-xs text-gray-600 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="font-semibold">Текущий период:</span>{' '}
          {format(new Date(data.from), 'd MMM yyyy')} → {format(new Date(data.to), 'd MMM yyyy')}
        </div>
        <div className="text-gray-500">
          <span className="font-semibold">vs Прошлый:</span>{' '}
          {format(new Date(data.prevFrom), 'd MMM yyyy')} → {format(new Date(data.prevTo), 'd MMM yyyy')}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="panel lg:col-span-1">
          <div className="panel-header"><div className="panel-title">Доли категорий</div></div>
          <div className="p-3">
            <PieBreakdown data={pieData} height={280} />
          </div>
        </div>

        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <div className="panel-title">Тренд расходов · 6 месяцев</div>
            <div className="text-xs text-gray-500">стак по топ-5 категориям</div>
          </div>
          <div className="p-3" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtCompact} />
                <Tooltip
                  formatter={(value: any, name: string) => [fmt(Number(value)) + ' ₸', labelByCat[name] || (name === '_other' ? 'Прочие категории' : name)]}
                  labelFormatter={(l) => `Месяц: ${l}`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend formatter={(v) => labelByCat[v] || (v === '_other' ? 'Прочие категории' : v)} wrapperStyle={{ fontSize: 11 }} />
                {topCategoryKeys.map((k, i) => (
                  <Bar key={k} dataKey={k} stackId="a" fill={COLORS[i % COLORS.length]} />
                ))}
                <Bar dataKey="_other" stackId="a" fill="#cbd5e1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="panel p-3 flex items-center gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Поиск категория / статья / контрагент…"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[280px] focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="text-xs text-gray-500">
          Категорий: <b>{filteredRows.length}</b> / {data.rows.length}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setOpened(new Set(filteredRows.map((r: any) => r.category)))}
            className="text-xs text-brand-600 hover:underline"
          >
            Развернуть всё
          </button>
          <span className="text-xs text-gray-300">|</span>
          <button
            onClick={() => setOpened(new Set())}
            className="text-xs text-brand-600 hover:underline"
          >
            Свернуть всё
          </button>
          {search && (
            <>
              <span className="text-xs text-gray-300">|</span>
              <button onClick={() => setSearch('')} className="text-xs text-brand-600 hover:underline">
                Сбросить поиск ×
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main detailed table */}
      <div className="panel">
        <div className="max-h-[72vh] overflow-auto">
          <table className="report w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
              <tr>
                <th className="text-left">Категория · статья · контрагент</th>
                <th className="text-right w-32">Сумма</th>
                <th className="text-right w-28">Прошлый</th>
                <th className="text-right w-24">Δ</th>
                <th className="text-right w-40">Доля</th>
                <th className="text-right w-16">Док.</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr><td colSpan={6} className="text-center text-gray-500 py-8">Нет данных</td></tr>
              )}
              {filteredRows.map((r: any, i: number) => {
                const isOpen = opened.has(r.category);
                const c = COLORS[data.categoriesOrder.indexOf(r.category) % COLORS.length];
                const deltaArr = r.delta > 0 ? '↑' : r.delta < 0 ? '↓' : '→';
                const deltaClr = r.delta > 0 ? 'text-rose-700' : r.delta < 0 ? 'text-emerald-700' : 'text-gray-400';
                return (
                  <>
                    <tr key={r.category} className="cursor-pointer hover:bg-gray-50 border-t border-gray-100" onClick={() => toggle(r.category)}>
                      <td>
                        <div className="flex items-center gap-2">
                          <IconChevronDown
                            width={12}
                            height={12}
                            className={'text-gray-400 transition-transform ' + (isOpen ? '' : '-rotate-90')}
                          />
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                          <span className="font-semibold">{r.label}</span>
                          <span className="text-[11px] text-gray-400">{r.articles.length} ст., {r.topKontragenty.length} контр.</span>
                        </div>
                      </td>
                      <td className="num font-semibold">{fmt(r.amount)}</td>
                      <td className="num text-xs text-gray-500">{fmt(r.prevAmount)}</td>
                      <td className={'num text-xs font-medium ' + deltaClr}>
                        {deltaArr} {fmtCompact(Math.abs(r.delta))}
                        {r.prevAmount > 0 && (
                          <div className="text-[10px] text-gray-400 font-normal">
                            {r.deltaPct > 0 ? '+' : ''}{r.deltaPct.toFixed(1)}%
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="h-1.5 w-24 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${r.share}%`, background: c }} />
                          </div>
                          <span className="text-xs text-gray-600 w-12 text-right">{r.share.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="num text-xs text-gray-500">{r.docCount}</td>
                    </tr>
                    {isOpen && (
                      <>
                        {/* Top контрагенты */}
                        {r.topKontragenty.length > 0 && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={6} className="!py-2 !px-4">
                              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Топ контрагенты</div>
                              <div className="flex flex-wrap gap-2">
                                {r.topKontragenty.map((k: any) => (
                                  <span key={k.name} className="inline-flex items-baseline gap-1.5 bg-white border border-gray-200 rounded-md px-2 py-0.5 text-xs">
                                    <span className="text-gray-700">{k.name}</span>
                                    <span className="text-gray-500 text-[10px]">{fmtCompact(k.amount)} ₸ · {k.docCount}</span>
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        {/* Статьи */}
                        {r.articles.map((a: any) => {
                          const aDelta = a.amount - a.prevAmount;
                          const aDeltaArr = aDelta > 0 ? '↑' : aDelta < 0 ? '↓' : '→';
                          const aClr = aDelta > 0 ? 'text-rose-600' : aDelta < 0 ? 'text-emerald-600' : 'text-gray-400';
                          return (
                            <tr key={a.name} className="bg-gray-50/30 hover:bg-gray-100/60">
                              <td className="text-xs pl-10">
                                <button
                                  onClick={(e) => { e.stopPropagation(); openDrill(r.category, `${r.label} · ${a.name}`, a.name); }}
                                  className="text-left text-gray-700 hover:text-brand-700 hover:underline"
                                >
                                  {a.name}
                                </button>
                              </td>
                              <td className="num text-xs">{fmt(a.amount)}</td>
                              <td className="num text-xs text-gray-400">{fmt(a.prevAmount)}</td>
                              <td className={'num text-[11px] ' + aClr}>
                                {a.prevAmount > 0 ? `${aDeltaArr} ${fmtCompact(Math.abs(aDelta))}` : ''}
                              </td>
                              <td className="text-right">
                                <div className="flex items-center gap-2 justify-end">
                                  <div className="h-1 w-20 rounded-full bg-gray-100 overflow-hidden">
                                    <div className="h-full rounded-full opacity-70" style={{ width: `${a.share}%`, background: c }} />
                                  </div>
                                  <span className="text-[10px] text-gray-500 w-10 text-right">{a.share.toFixed(1)}%</span>
                                </div>
                              </td>
                              <td className="num text-xs text-gray-400">{a.docCount}</td>
                            </tr>
                          );
                        })}
                      </>
                    )}
                  </>
                );
              })}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 bg-brand-50 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                <tr className="font-semibold border-t-2 border-brand-200">
                  <td className="text-right uppercase tracking-wider text-brand-700 text-xs">ИТОГО{search ? ' (фильтр)' : ''}</td>
                  <td className="num">{fmt(filteredRows.reduce((s: number, r: any) => s + r.amount, 0))}</td>
                  <td className="num text-xs text-gray-600">{fmt(filteredRows.reduce((s: number, r: any) => s + r.prevAmount, 0))}</td>
                  <td className="num text-xs"></td>
                  <td className="num text-xs">{filteredRows.reduce((s: number, r: any) => s + r.share, 0).toFixed(1)}%</td>
                  <td className="num text-xs">{filteredRows.reduce((s: number, r: any) => s + r.docCount, 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Footer note */}
      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 О методе и источниках</div>
        <div className="space-y-1">
          <div><b>Источник</b>: исходящие платежи 1С (<code>DdsDocument.direction='outflow'</code>), сгруппированные по категории <code>DdsArticle.opiuCategory</code>.</div>
          <div><b>Внутренние перемещения</b> (между нашими кассами/счетами) исключены — это не расходы, а движение денег.</div>
          <div><b>Кассовый метод</b>: расходы по дате выплаты. Например, ЗП-выплата 5 марта попадёт в март, а не в февраль (даже если начислена за февраль). Это отличается от ОПиУ, где ЗП учитывается accrual-методом по месяцу начисления.</div>
          <div><b>Сравнение с прошлым периодом</b>: предыдущий отрезок такой же длины, прилегающий к началу текущего. Например, если текущий — апрель, сравнение с мартом.</div>
          <div><b>Кликните по статье</b>, чтобы открыть детализацию по документам.</div>
        </div>
      </div>

      {/* Drill-down modal */}
      {drill && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-semibold">{drill.label}</h3>
                <div className="text-xs text-gray-500">
                  {format(new Date(data.from), 'd MMM yyyy')} → {format(new Date(data.to), 'd MMM yyyy')}
                  {drill.docs.length > 0 && ` · ${drill.docs.length} док · ${fmt(drill.docs.reduce((s, d) => s + d.amount, 0))} ₸`}
                </div>
              </div>
              <button onClick={() => setDrill(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="p-4">
              {drillLoading ? (
                <div className="text-sm text-gray-500">Загрузка…</div>
              ) : drill.docs.length === 0 ? (
                <div className="text-sm text-gray-500">Нет документов</div>
              ) : (
                <table className="report">
                  <thead>
                    <tr>
                      <th className="text-left">Дата</th>
                      <th className="text-left">№</th>
                      <th className="text-left">Контрагент</th>
                      <th className="text-left">Статья</th>
                      <th className="text-right">Сумма</th>
                      <th className="text-left">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.docs.map((d) => (
                      <tr key={d.id}>
                        <td className="text-xs">{format(new Date(d.date), 'dd.MM.yyyy')}</td>
                        <td className="text-xs">{d.number}</td>
                        <td className="text-xs">{d.counterparty || '—'}</td>
                        <td className="text-xs text-gray-600">{d.article || '—'}</td>
                        <td className="num">{fmt(d.amount)}</td>
                        <td className="text-xs text-gray-500 max-w-md truncate">{d.comment || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiBlock({ label, value, suffix, sub, colorClass }: any) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + (colorClass || 'text-gray-900')}>
        {value}
        {suffix && <span className="text-base font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

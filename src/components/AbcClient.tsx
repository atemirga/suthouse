'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { PieBreakdown } from './Charts';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from 'recharts';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtKg = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
};

const CLASS_COLOR: Record<'A' | 'B' | 'C', string> = {
  A: '#10b981',
  B: '#f59e0b',
  C: '#94a3b8',
};
const CLASS_BG: Record<'A' | 'B' | 'C', string> = {
  A: '#ecfdf5',
  B: '#fffbeb',
  C: '#f8fafc',
};

type Param = 'revenue' | 'profit' | 'quantity';

const PARAM_META: Record<Param, { label: string; valueLabel: string; unit: string }> = {
  revenue: { label: 'Выручка', valueLabel: 'Выручка', unit: '₸' },
  profit: { label: 'Прибыль', valueLabel: 'Валовая прибыль', unit: '₸' },
  quantity: { label: 'КГ', valueLabel: 'Масса', unit: 'кг' },
};

export default function AbcClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const param: Param = (sp.get('param') as Param) || 'revenue';
  const meta = PARAM_META[param];

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/abc?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setParam(v: string) {
    const p = new URLSearchParams(sp.toString());
    p.set('param', v);
    router.push(`${pathname}?${p.toString()}`);
  }

  // Уникальные категории — для фильтра
  const categories = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.rows as any[]) if (r.category) s.add(r.category);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return (data.rows as any[]).filter((r) => {
      if (classFilter !== 'all' && r.abcClass !== classFilter) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, classFilter, categoryFilter]);

  // Итоги для отфильтрованного среза (для строки внизу/вверху таблицы)
  const filteredTotals = useMemo(() => {
    const t = { revenue: 0, cost: 0, profit: 0, quantity: 0, share: 0 };
    for (const r of filtered) {
      t.revenue += r.revenue;
      t.cost += r.cost;
      t.profit += r.profit;
      t.quantity += r.quantity;
      t.share += r.share;
    }
    return t;
  }, [filtered]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const t = data.totals;
  const cls = data.classCounts;
  const ct = data.classTotals;

  const pieData = (['A', 'B', 'C'] as const).map((c) => ({
    name: `Класс ${c} (${cls[c]} SKU)`,
    value: param === 'revenue' ? ct[c].revenue : param === 'profit' ? ct[c].profit : ct[c].quantity,
  }));

  // Pareto-кривая: топ-N SKU с накопительной долей
  const paretoData = (data.rows as any[])
    .slice(0, Math.min(40, data.rows.length))
    .map((r, i) => ({
      idx: i + 1,
      name: r.name,
      value: param === 'revenue' ? r.revenue : param === 'profit' ? r.profit : r.quantity,
      cumShare: Number(r.cumShare.toFixed(1)),
    }));

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiBlock label="Всего SKU" value={t.skuCount.toLocaleString('ru-RU')} />
        <KpiBlock label="Выручка" value={fmtCompact(t.revenue)} suffix="₸" />
        <KpiBlock label="Масса" value={fmtCompact(t.quantity)} suffix="кг" />
        <KpiBlock label="Ср. цена" value={fmt(t.avgPrice)} suffix="₸/кг" />
        <KpiBlock
          label="Валовая прибыль"
          value={fmtCompact(t.profit)}
          suffix="₸"
          sub={`${(t.margin * 100).toFixed(1)}% маржа`}
          color={t.profit > 0 ? 'green' : 'red'}
        />
      </div>

      {/* Class summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(['A', 'B', 'C'] as const).map((c) => {
          const count = cls[c];
          const pct = t.skuCount > 0 ? (count / t.skuCount) * 100 : 0;
          const val = param === 'revenue' ? ct[c].revenue : param === 'profit' ? ct[c].profit : ct[c].quantity;
          const totalVal = param === 'revenue' ? t.revenue : param === 'profit' ? t.profit : t.quantity;
          const valPct = totalVal > 0 ? (val / totalVal) * 100 : 0;
          const margin = ct[c].revenue > 0 ? (ct[c].profit / ct[c].revenue) * 100 : 0;
          const active = classFilter === c;
          return (
            <button
              key={c}
              onClick={() => setClassFilter(active ? 'all' : c)}
              className="text-left p-4 rounded-xl border-2 transition-all bg-white hover:shadow-md"
              style={{
                borderColor: active ? CLASS_COLOR[c] : '#e5e7eb',
                background: active ? CLASS_BG[c] : '#fff',
              }}
            >
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-bold tabular-nums" style={{ color: CLASS_COLOR[c] }}>{c}</div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider">класс</div>
                </div>
                {active && <span className="text-[10px] uppercase font-semibold text-gray-500">фильтр активен</span>}
              </div>
              <div className="mt-1 text-sm">
                <span className="font-semibold">{count} SKU</span>
                <span className="text-gray-500"> ({pct.toFixed(1)}%)</span>
              </div>
              <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                <div className="flex justify-between"><span>Выручка</span><b>{fmtCompact(ct[c].revenue)} ₸</b></div>
                <div className="flex justify-between"><span>Масса</span><b>{fmtCompact(ct[c].quantity)} кг</b></div>
                <div className="flex justify-between"><span>Прибыль</span><b>{fmtCompact(ct[c].profit)} ₸</b></div>
                <div className="flex justify-between"><span>Маржа</span><b>{margin.toFixed(1)}%</b></div>
              </div>
              {/* progress bar показывает долю в текущем параметре */}
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${valPct.toFixed(1)}%`, background: CLASS_COLOR[c] }}
                />
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">{valPct.toFixed(1)}% от {meta.label.toLowerCase()}</div>
            </button>
          );
        })}
      </div>

      {/* Param selector + Pie + Pareto */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <div className="panel-title">Кривая Парето · топ-40 SKU</div>
            <div className="toggle-group">
              <button onClick={() => setParam('revenue')} className={'toggle-btn ' + (param === 'revenue' ? 'toggle-btn-active' : '')}>Выручка ₸</button>
              <button onClick={() => setParam('profit')} className={'toggle-btn ' + (param === 'profit' ? 'toggle-btn-active' : '')}>Прибыль ₸</button>
              <button onClick={() => setParam('quantity')} className={'toggle-btn ' + (param === 'quantity' ? 'toggle-btn-active' : '')}>КГ</button>
            </div>
          </div>
          <div className="p-3" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={paretoData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="idx" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={fmtCompact} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip
                  formatter={(value: any, name: string) => {
                    if (name === 'cumShare') return [value + '%', 'Накопл.'];
                    return [fmt(Number(value)) + ' ' + meta.unit, meta.label];
                  }}
                  labelFormatter={(idx) => {
                    const item = paretoData[Number(idx) - 1];
                    return item ? `#${idx} · ${item.name}` : `#${idx}`;
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar yAxisId="left" dataKey="value" fill={CLASS_COLOR.A} name={meta.label} />
                <Line yAxisId="right" type="monotone" dataKey="cumShare" stroke="#dc2626" strokeWidth={2} dot={false} name="Накопл. %" />
                <ReferenceLine yAxisId="right" y={80} stroke="#10b981" strokeDasharray="3 3" label={{ value: '80% (A)', position: 'right', fontSize: 10, fill: '#10b981' }} />
                <ReferenceLine yAxisId="right" y={95} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '95% (B)', position: 'right', fontSize: 10, fill: '#f59e0b' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Доля по классам</div>
          </div>
          <div className="p-3">
            <PieBreakdown data={pieData} height={220} />
            <div className="mt-2 text-center text-xs text-gray-500">{meta.label}, {meta.unit}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Поиск SKU…"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px] focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="all">Все категории</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <div className="text-xs text-gray-500">
            Показано {filtered.length} из {data.rows.length} SKU
          </div>
          {(classFilter !== 'all' || categoryFilter !== 'all' || search) && (
            <button
              onClick={() => { setClassFilter('all'); setCategoryFilter('all'); setSearch(''); }}
              className="text-xs text-brand-600 hover:underline ml-auto"
            >
              Сбросить все фильтры ×
            </button>
          )}
        </div>
      </div>

      {/* Таблица: sticky header + sticky totals */}
      <div className="panel">
        <div className="max-h-[70vh] overflow-auto relative">
          <table className="report w-full">
            <thead className="sticky top-0 z-20 bg-gray-50 shadow-sm">
              <tr>
                <th className="w-10 text-gray-500 text-right">#</th>
                <th className="w-14">Класс</th>
                <th className="text-left">Номенклатура</th>
                <th className="text-left text-xs text-gray-500">Категория</th>
                <th className="text-right">Масса, кг</th>
                <th className="text-right">Ср. цена ₸/кг</th>
                <th className="text-right">Выручка, ₸</th>
                <th className="text-right">Себестоимость, ₸</th>
                <th className="text-right">Прибыль, ₸</th>
                <th className="text-right">Маржа</th>
                <th className="text-right">Доля</th>
                <th className="text-right">Накопл.</th>
              </tr>
            </thead>
            <tbody>
              {/* Top totals row (фильтрованный срез) */}
              <tr className="bg-brand-50 font-semibold border-b-2 border-brand-200 sticky top-[37px] z-10">
                <td colSpan={4} className="text-right text-xs uppercase tracking-wider text-brand-700">
                  ИТОГО {filtered.length !== data.rows.length ? '(фильтр)' : '(всё)'}
                </td>
                <td className="num">{fmtKg(filteredTotals.quantity)}</td>
                <td className="num text-xs text-gray-500">{filteredTotals.quantity > 0 ? fmt(filteredTotals.revenue / filteredTotals.quantity) : '—'}</td>
                <td className="num">{fmt(filteredTotals.revenue)}</td>
                <td className="num text-xs text-gray-500">{fmt(filteredTotals.cost)}</td>
                <td className={'num ' + (filteredTotals.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(filteredTotals.profit)}</td>
                <td className="num text-xs">{filteredTotals.revenue > 0 ? ((filteredTotals.profit / filteredTotals.revenue) * 100).toFixed(1) + '%' : '—'}</td>
                <td className="num text-xs">{filteredTotals.share.toFixed(1)}%</td>
                <td></td>
              </tr>
              {filtered.length === 0 && (
                <tr><td colSpan={12} className="text-center text-gray-500 py-8">Нет данных под текущие фильтры</td></tr>
              )}
              {filtered.slice(0, 1000).map((r: any, i: number) => (
                <tr key={r.nomenclatureId || i} className="hover:bg-gray-50">
                  <td className="text-gray-400 text-xs num">{i + 1}</td>
                  <td>
                    <span
                      className="inline-flex w-6 h-6 rounded text-xs font-bold items-center justify-center text-white"
                      style={{ background: CLASS_COLOR[r.abcClass as 'A' | 'B' | 'C'] }}
                    >
                      {r.abcClass}
                    </span>
                  </td>
                  <td className="text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-0.5 h-4 rounded-full"
                        style={{ background: CLASS_COLOR[r.abcClass as 'A' | 'B' | 'C'] }}
                      />
                      <span>{r.name}</span>
                    </div>
                  </td>
                  <td className="text-[11px] text-gray-500">{r.category || '—'}</td>
                  <td className="num text-xs">{fmtKg(r.quantity)}</td>
                  <td className="num text-xs text-gray-600">{fmt(r.avgPrice)}</td>
                  <td className="num">{fmt(r.revenue)}</td>
                  <td className="num text-xs text-gray-500">{fmt(r.cost)}</td>
                  <td className={'num ' + (r.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(r.profit)}</td>
                  <td className="num text-xs">{(r.margin * 100).toFixed(1)}%</td>
                  <td className="num text-xs">{r.share.toFixed(2)}%</td>
                  <td className="num text-xs text-gray-500">{r.cumShare.toFixed(1)}%</td>
                </tr>
              ))}
              {filtered.length > 1000 && (
                <tr>
                  <td colSpan={12} className="text-center text-xs text-gray-500 py-2">
                    …показано первых 1000 из {filtered.length}. Уточните фильтр для просмотра остатка.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-brand-50 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
              <tr className="font-semibold border-t-2 border-brand-200">
                <td colSpan={4} className="text-right text-xs uppercase tracking-wider text-brand-700">
                  ИТОГО {filtered.length !== data.rows.length ? '(фильтр)' : '(всё)'}
                </td>
                <td className="num">{fmtKg(filteredTotals.quantity)}</td>
                <td className="num text-xs text-gray-500">{filteredTotals.quantity > 0 ? fmt(filteredTotals.revenue / filteredTotals.quantity) : '—'}</td>
                <td className="num">{fmt(filteredTotals.revenue)}</td>
                <td className="num text-xs text-gray-500">{fmt(filteredTotals.cost)}</td>
                <td className={'num ' + (filteredTotals.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(filteredTotals.profit)}</td>
                <td className="num text-xs">{filteredTotals.revenue > 0 ? ((filteredTotals.profit / filteredTotals.revenue) * 100).toFixed(1) + '%' : '—'}</td>
                <td className="num text-xs">{filteredTotals.share.toFixed(1)}%</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📊 Методика и источники</div>
        <div className="space-y-1">
          <div><b>Парето 80/15/5</b>: класс A — топ-SKU, дающие 80% выбранного параметра; B — следующие 15%; C — остальные.</div>
          <div><b>Масса (КГ)</b>: значение из <code>RealizaciaItem.quantity</code>. Все товары в этом бизнесе весовые — единица измерения = кг.</div>
          <div><b>Выручка</b>: <code>Σ RealizaciaItem.amount</code> по периоду. Совпадает копейка-в-копейку с <code>Realizacia.itemsAmount</code> и строкой «Выручка» в ОПиУ.</div>
          <div><b>Себестоимость</b>: масштабированная FIFO-стоимость через коэффициент <code>factCost / totalCost</code> родительской реализации. Источник истины factCost — <code>AccumulationRegister_Запасы</code> 1С.</div>
          <div><b>Маржа</b> = Прибыль / Выручка по строке (не средняя по классу).</div>
        </div>
      </div>
    </div>
  );
}

function KpiBlock({ label, value, suffix, sub, color }: any) {
  const colorClasses: Record<string, string> = {
    green: 'text-emerald-700',
    red: 'text-rose-700',
  };
  const c = color ? colorClasses[color] : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + c}>
        {value}{suffix && <span className="text-base font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

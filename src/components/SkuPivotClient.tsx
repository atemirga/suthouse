'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtKg = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
};

type Metric = 'revenue' | 'kg';
type SortKey =
  | 'name'
  | 'category'
  | 'kg'
  | 'avgPrice'
  | 'revenue'
  | 'cost'
  | 'profit'
  | 'margin'
  | 'delta'
  | { manager: string };

interface DrillRow {
  realizaciaId: string;
  date: string;
  number: string;
  kontragent: string | null;
  manager: string | null;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
}

export default function SkuPivotClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [mgrFilter, setMgrFilter] = useState<string>('all');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [drillSku, setDrillSkuState] = useState<any | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillData, setDrillData] = useState<DrillRow[]>([]);
  const [drillMgrFilter, setDrillMgrFilter] = useState<string>('all');
  const [drillCatFilter, setDrillCatFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/by-sku?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setSort(k: SortKey) {
    if (JSON.stringify(k) === JSON.stringify(sortKey)) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir(typeof k === 'string' && k === 'name' ? 'asc' : 'desc');
    }
  }

  async function openDrill(sku: any) {
    if (!sku.nomenclatureId) return;
    setDrillSkuState(sku);
    setDrillMgrFilter('all');
    setDrillCatFilter('all');
    setDrillLoading(true);
    setDrillData([]);
    try {
      const p = new URLSearchParams(sp.toString());
      p.set('drill', sku.nomenclatureId);
      const r = await fetch('/api/sales/by-sku?' + p.toString());
      const d = await r.json();
      setDrillData(d.items || []);
    } finally {
      setDrillLoading(false);
    }
  }

  // Уникальные категории — для фильтра
  const categories = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.rows as any[]) if (r.category) s.add(r.category);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let rows = data.rows as any[];
    if (q) {
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q),
      );
    }
    if (mgrFilter !== 'all') {
      rows = rows.filter((r) => r.byManager[mgrFilter]);
    }
    if (catFilter !== 'all') {
      rows = rows.filter((r) => (r.category || '— без категории —') === catFilter);
    }
    // Сортировка
    const getValue = (r: any): number | string => {
      if (typeof sortKey === 'object' && 'manager' in sortKey) {
        const v = r.byManager[sortKey.manager];
        return v ? (metric === 'revenue' ? v.revenue : v.qty) : 0;
      }
      switch (sortKey) {
        case 'name': return r.name.toLowerCase();
        case 'category': return (r.category || '').toLowerCase();
        case 'kg': return r.totalQuantity;
        case 'avgPrice': return r.avgPrice;
        case 'revenue': return r.totalRevenue;
        case 'cost': return r.totalCost;
        case 'profit': return r.totalProfit;
        case 'margin': return r.margin;
        case 'delta': return r.deltaRevenuePct;
      }
      return 0;
    };
    rows = [...rows].sort((a, b) => {
      const va = getValue(a); const vb = getValue(b);
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string, 'ru') : (vb as string).localeCompare(va, 'ru');
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return rows;
  }, [data, search, mgrFilter, catFilter, sortKey, sortDir, metric]);

  const filteredTotals = useMemo(() => {
    const t = { kg: 0, revenue: 0, cost: 0, profit: 0 };
    for (const r of filteredRows) {
      t.kg += r.totalQuantity;
      t.revenue += r.totalRevenue;
      t.cost += r.totalCost;
      t.profit += r.totalProfit;
    }
    return t;
  }, [filteredRows]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const tt = data.totals;
  const visibleManagers = mgrFilter === 'all' ? data.managers : [mgrFilter];

  const SortHeader = ({ label, k, align = 'right' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => {
    const active = JSON.stringify(k) === JSON.stringify(sortKey);
    const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return (
      <th
        className={`cursor-pointer select-none hover:bg-gray-100 ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => setSort(k)}
      >
        <span className={active ? 'text-brand-700 font-semibold' : ''}>{label}{arrow}</span>
      </th>
    );
  };

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="SKU в продажах" value={tt.skuCount.toLocaleString('ru-RU')} />
        <Kpi label="Отгружено" value={fmtCompact(tt.quantity)} suffix="кг" />
        <Kpi label="Выручка" value={fmtCompact(tt.revenue)} suffix="₸" sub={data.prevTotals.revenue > 0 ? `${((tt.revenue/data.prevTotals.revenue - 1) * 100).toFixed(1)}% к прошл.` : ''} />
        <Kpi label="Ср. цена" value={fmt(tt.avgPrice)} suffix="₸/кг" />
        <Kpi label="Валовая прибыль" value={fmtCompact(tt.profit)} suffix="₸"
             sub={`${(tt.margin * 100).toFixed(1)}% маржа`}
             color={tt.profit > 0 ? 'green' : 'red'} />
      </div>

      {/* Filters */}
      <div className="panel p-3 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Поиск SKU / категория…"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px] focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={mgrFilter}
          onChange={(e) => setMgrFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">Все менеджеры ({data.managers.length})</option>
          {data.managers.map((m: string) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        {categories.length > 0 && (
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">Все категории ({categories.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <div className="text-xs text-gray-500">
          Показано <b>{filteredRows.length}</b> из {data.rows.length} SKU
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-gray-500 uppercase tracking-wider">Значение в столбцах:</span>
          <div className="toggle-group">
            <button onClick={() => setMetric('revenue')} className={'toggle-btn ' + (metric === 'revenue' ? 'toggle-btn-active' : '')}>Выручка ₸</button>
            <button onClick={() => setMetric('kg')} className={'toggle-btn ' + (metric === 'kg' ? 'toggle-btn-active' : '')}>КГ</button>
          </div>
        </div>
        {(search || mgrFilter !== 'all' || catFilter !== 'all') && (
          <button onClick={() => { setSearch(''); setMgrFilter('all'); setCatFilter('all'); }} className="text-xs text-brand-600 hover:underline">
            Сбросить ×
          </button>
        )}
      </div>

      {/* Table */}
      <div className="panel">
        <div className="max-h-[75vh] overflow-auto">
          <table className="report w-full" style={{ minWidth: 1100 + visibleManagers.length * 130 }}>
            <thead className="sticky top-0 z-20 bg-gray-50 shadow-sm">
              <tr>
                <th className="w-10 text-gray-500 text-right">#</th>
                <th className="sticky left-0 bg-gray-50 z-30 min-w-[280px]">
                  <span className="cursor-pointer select-none" onClick={() => setSort('name')}>
                    Позиция{sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </span>
                </th>
                <SortHeader label="Категория" k="category" align="left" />
                <SortHeader label="КГ" k="kg" />
                <SortHeader label="₸/кг" k="avgPrice" />
                <SortHeader label="Выручка" k="revenue" />
                <SortHeader label="Cost" k="cost" />
                <SortHeader label="Прибыль" k="profit" />
                <SortHeader label="Маржа" k="margin" />
                <SortHeader label="Δ vs прошл." k="delta" />
                {visibleManagers.map((m: string) => (
                  <SortHeader key={m} label={m} k={{ manager: m }} />
                ))}
                <th className="text-right bg-brand-100 sticky right-0 z-20 whitespace-nowrap">Итого {metric === 'revenue' ? '₸' : 'кг'}</th>
              </tr>
            </thead>
            <tbody>
              {/* Sticky-итого вверху */}
              <tr className="bg-brand-50 font-semibold border-b-2 border-brand-200 sticky top-[37px] z-10">
                <td colSpan={3} className="text-right text-xs uppercase tracking-wider text-brand-700 sticky left-0 bg-brand-50 z-20">
                  ИТОГО{(search || mgrFilter !== 'all' || catFilter !== 'all') ? ' (фильтр)' : ''}
                </td>
                <td className="num">{fmtKg(filteredTotals.kg)}</td>
                <td className="num text-xs text-gray-500">{filteredTotals.kg > 0 ? fmt(filteredTotals.revenue / filteredTotals.kg) : '—'}</td>
                <td className="num">{fmt(filteredTotals.revenue)}</td>
                <td className="num text-xs text-gray-500">{fmt(filteredTotals.cost)}</td>
                <td className={'num ' + (filteredTotals.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(filteredTotals.profit)}</td>
                <td className="num text-xs">{filteredTotals.revenue > 0 ? ((filteredTotals.profit / filteredTotals.revenue) * 100).toFixed(1) + '%' : '—'}</td>
                <td></td>
                {visibleManagers.map((m: string) => {
                  const v = data.totals.byManager[m];
                  const val = v ? (metric === 'revenue' ? v.revenue : v.qty) : 0;
                  return <td key={m} className="num text-xs">{metric === 'kg' ? fmtKg(val) : fmt(val)}</td>;
                })}
                <td className="num bg-brand-100 sticky right-0">
                  {metric === 'kg' ? fmtKg(filteredTotals.kg) : fmt(filteredTotals.revenue)}
                </td>
              </tr>

              {filteredRows.length === 0 && (
                <tr><td colSpan={10 + visibleManagers.length} className="text-center text-gray-500 py-8">Нет данных под фильтры</td></tr>
              )}
              {filteredRows.slice(0, 1000).map((r: any, i: number) => {
                const total = metric === 'revenue' ? r.totalRevenue : r.totalQuantity;
                const dArr = r.deltaRevenuePct > 0 ? '↑' : r.deltaRevenuePct < 0 ? '↓' : '→';
                const dClr = r.deltaRevenuePct > 0 ? 'text-emerald-700' : r.deltaRevenuePct < 0 ? 'text-rose-700' : 'text-gray-400';
                return (
                  <tr key={r.nomenclatureId || i} className="hover:bg-gray-50">
                    <td className="text-gray-400 text-xs num">{i + 1}</td>
                    <td className="text-xs sticky left-0 bg-white hover:bg-gray-50 z-10">
                      <button
                        onClick={() => openDrill(r)}
                        className="text-left text-gray-800 hover:text-brand-700 hover:underline"
                        disabled={!r.nomenclatureId}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="text-[11px] text-gray-500">{r.category || '—'}</td>
                    <td className="num text-xs font-medium">{fmtKg(r.totalQuantity)}</td>
                    <td className="num text-xs text-gray-600">{fmt(r.avgPrice)}</td>
                    <td className="num">{fmt(r.totalRevenue)}</td>
                    <td className="num text-xs text-gray-500">{fmt(r.totalCost)}</td>
                    <td className={'num text-xs ' + (r.totalProfit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(r.totalProfit)}</td>
                    <td className="num text-xs">{(r.margin * 100).toFixed(1)}%</td>
                    <td className={'num text-xs ' + dClr}>
                      {r.prevRevenue > 0 ? `${dArr} ${Math.abs(r.deltaRevenuePct).toFixed(0)}%` : <span className="text-gray-300">—</span>}
                    </td>
                    {visibleManagers.map((m: string) => {
                      const v = r.byManager[m];
                      const val = v ? (metric === 'revenue' ? v.revenue : v.qty) : 0;
                      return (
                        <td key={m} className="num text-xs">
                          {val > 0 ? (metric === 'kg' ? fmtKg(val) : fmt(val)) : <span className="text-gray-300">—</span>}
                        </td>
                      );
                    })}
                    <td className="num font-semibold bg-brand-50/60 sticky right-0">
                      {metric === 'kg' ? fmtKg(total) : fmt(total)}
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length > 1000 && (
                <tr><td colSpan={10 + visibleManagers.length} className="text-center text-xs text-gray-500 py-2">…показано первые 1000 строк</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 Источники и методика</div>
        <div className="space-y-1">
          <div><b>Источник</b>: <code>RealizaciaItem</code> ← <code>Realizacia</code> (1С «Расходная накладная»). Это РЕАЛЬНО отгруженные позиции. Заказы, которые клиент потом отменил, тут НЕ показываются.</div>
          <div><b>КГ</b>: <code>quantity</code> из накладной. В этом бизнесе все товары весовые — единица = кг.</div>
          <div><b>Выручка</b>: <code>amount</code> (со скидкой), сходится с «Выручкой» в ОПиУ.</div>
          <div><b>Cost</b>: масштабированный FIFO через factCost/totalCost. Источник истины factCost — <code>AccumulationRegister_Запасы</code> 1С.</div>
          <div><b>Δ vs прошл.</b>: изменение выручки SKU vs предыдущий период такого же размера.</div>
          <div><b>Клик по позиции</b> — детализация по конкретным накладным.</div>
        </div>
      </div>

      {/* Drill-down modal */}
      {drillSku && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDrillSkuState(null)}>
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 sticky top-0 bg-white z-10">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{drillSku.name}</h3>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {drillSku.category || 'без категории'} · {format(new Date(data.from), 'd MMM yyyy')} → {format(new Date(data.to), 'd MMM yyyy')}
                  </div>
                </div>
                <button onClick={() => setDrillSkuState(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                <Mini label="Отгружено" value={`${fmtKg(drillSku.totalQuantity)} кг`} />
                <Mini label="Выручка" value={`${fmt(drillSku.totalRevenue)} ₸`} />
                <Mini label="Ср. цена" value={`${fmt(drillSku.avgPrice)} ₸/кг`} />
                <Mini label="Прибыль" value={`${fmt(drillSku.totalProfit)} ₸`} color={drillSku.totalProfit > 0 ? 'g' : 'r'} />
                <Mini label="Маржа" value={`${(drillSku.margin * 100).toFixed(1)}%`} />
              </div>
            </div>
            <div className="p-4 space-y-4">
              {drillLoading && <div className="text-sm text-gray-500">Загружаем накладные…</div>}

              {/* По менеджерам */}
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Распределение по менеджерам</div>
                <div className="space-y-1.5">
                  {Object.entries(drillSku.byManager)
                    .sort((a: any, b: any) => b[1].revenue - a[1].revenue)
                    .map(([m, v]: any) => {
                      const pct = drillSku.totalRevenue > 0 ? (v.revenue / drillSku.totalRevenue) * 100 : 0;
                      return (
                        <div key={m} className="flex items-center gap-3 text-sm">
                          <span className="min-w-[140px] text-gray-700">{m}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="min-w-[80px] text-right tabular-nums">{fmtKg(v.qty)} кг</span>
                          <span className="min-w-[100px] text-right tabular-nums">{fmt(v.revenue)} ₸</span>
                          <span className="min-w-[50px] text-right text-xs text-gray-500">{pct.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Топ контрагенты */}
              {drillSku.topKontragenty && drillSku.topKontragenty.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Топ контрагенты</div>
                  <div className="flex flex-wrap gap-2">
                    {drillSku.topKontragenty.map((k: any) => (
                      <span key={k.name} className="inline-flex items-baseline gap-1.5 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1 text-xs">
                        <span className="text-gray-800">{k.name}</span>
                        <span className="text-gray-500 text-[10px]">{fmtKg(k.qty)} кг · {fmtCompact(k.revenue)} ₸</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Все накладные с фильтрами */}
              {drillData.length > 0 && (() => {
                const drillMgrs = Array.from(new Set(drillData.map((d) => d.manager || '— без менеджера —'))).sort();
                const drillKonts = Array.from(new Set(drillData.map((d) => d.kontragent || '— без клиента —'))).sort();
                const visibleDrill = drillData.filter((d) => {
                  if (drillMgrFilter !== 'all' && (d.manager || '— без менеджера —') !== drillMgrFilter) return false;
                  if (drillCatFilter !== 'all' && (d.kontragent || '— без клиента —') !== drillCatFilter) return false;
                  return true;
                });
                const drillTotals = visibleDrill.reduce(
                  (s, d) => ({ qty: s.qty + d.quantity, revenue: s.revenue + d.revenue, cost: s.cost + d.cost, profit: s.profit + d.profit }),
                  { qty: 0, revenue: 0, cost: 0, profit: 0 },
                );
                return (
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <div className="text-xs uppercase tracking-wider text-gray-500">
                        Все накладные ({visibleDrill.length}{visibleDrill.length !== drillData.length ? ` из ${drillData.length}` : ''})
                      </div>
                      <select
                        value={drillMgrFilter}
                        onChange={(e) => setDrillMgrFilter(e.target.value)}
                        className="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white"
                      >
                        <option value="all">Все менеджеры ({drillMgrs.length})</option>
                        {drillMgrs.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select
                        value={drillCatFilter}
                        onChange={(e) => setDrillCatFilter(e.target.value)}
                        className="border border-gray-300 rounded-md px-2 py-1 text-xs bg-white"
                      >
                        <option value="all">Все клиенты ({drillKonts.length})</option>
                        {drillKonts.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                      {(drillMgrFilter !== 'all' || drillCatFilter !== 'all') && (
                        <button
                          onClick={() => { setDrillMgrFilter('all'); setDrillCatFilter('all'); }}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Сбросить ×
                        </button>
                      )}
                      <div className="ml-auto text-xs text-gray-600 tabular-nums">
                        {fmtKg(drillTotals.qty)} кг · {fmt(drillTotals.revenue)} ₸ ·
                        <span className={drillTotals.profit > 0 ? 'text-emerald-700' : 'text-rose-700'}> {fmt(drillTotals.profit)} ₸ прибыль</span>
                      </div>
                    </div>
                    <table className="report w-full">
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th>№ накладной</th>
                          <th>Контрагент</th>
                          <th>Менеджер</th>
                          <th className="text-right">КГ</th>
                          <th className="text-right">Выручка</th>
                          <th className="text-right">Cost</th>
                          <th className="text-right">Прибыль</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDrill.map((d) => (
                          <tr key={d.realizaciaId}>
                            <td className="text-xs">{format(new Date(d.date), 'dd.MM.yyyy')}</td>
                            <td className="text-xs">{d.number}</td>
                            <td className="text-xs">{d.kontragent || '—'}</td>
                            <td className="text-xs">{d.manager || '—'}</td>
                            <td className="num text-xs">{fmtKg(d.quantity)}</td>
                            <td className="num text-xs">{fmt(d.revenue)}</td>
                            <td className="num text-xs text-gray-500">{fmt(d.cost)}</td>
                            <td className={'num text-xs ' + (d.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(d.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, suffix, sub, color }: any) {
  const c = color === 'green' ? 'text-emerald-700' : color === 'red' ? 'text-rose-700' : 'text-gray-900';
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

function Mini({ label, value, color }: { label: string; value: string; color?: 'g' | 'r' }) {
  const c = color === 'g' ? 'text-emerald-700' : color === 'r' ? 'text-rose-700' : 'text-gray-900';
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={'text-sm font-semibold tabular-nums ' + c}>{value}</div>
    </div>
  );
}

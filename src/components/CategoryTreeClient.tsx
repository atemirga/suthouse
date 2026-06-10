'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { IconChevronDown } from './Icons';
import { PieBreakdown } from './Charts';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtKg = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
};

type SortKey = 'name' | 'kg' | 'avgPrice' | 'revenue' | 'cost' | 'profit' | 'margin' | 'share' | 'delta' | 'sku';

interface SkuDrill {
  nomenclatureId: string;
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  avgPrice: number;
}

export default function CategoryTreeClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial.tree.slice(0, 5).map((n: any) => n.id)));
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [drillCat, setDrillCat] = useState<any | null>(null);
  const [drillData, setDrillData] = useState<SkuDrill[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/by-category?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc'); }
  }
  function toggle(id: string) {
    const n = new Set(expanded);
    if (n.has(id)) n.delete(id); else n.add(id);
    setExpanded(n);
  }
  function expandAll() {
    const all = new Set<string>();
    function walk(nodes: any[]) {
      for (const n of nodes) { all.add(n.id); if (n.children?.length) walk(n.children); }
    }
    walk(data.tree);
    setExpanded(all);
  }
  function collapseAll() { setExpanded(new Set()); }

  async function openDrill(cat: any) {
    setDrillCat(cat);
    setDrillLoading(true);
    setDrillData([]);
    try {
      const p = new URLSearchParams(sp.toString());
      p.set('drill', cat.id);
      const r = await fetch('/api/sales/by-category?' + p.toString());
      const d = await r.json();
      setDrillData(d.skus || []);
    } finally {
      setDrillLoading(false);
    }
  }

  // Сортировка дерева (рекурсивно)
  const sortedTree = useMemo(() => {
    if (!data) return [];
    function sortNodes(nodes: any[]): any[] {
      const total = data.totals.revenue || 1;
      const getValue = (n: any): number | string => {
        switch (sortKey) {
          case 'name': return n.name.toLowerCase();
          case 'kg': return n.quantity;
          case 'avgPrice': return n.avgPrice;
          case 'revenue': return n.revenue;
          case 'cost': return n.cost;
          case 'profit': return n.profit;
          case 'margin': return n.margin;
          case 'share': return n.revenue / total;
          case 'delta': return n.deltaRevenuePct;
          case 'sku': return n.skuCount;
        }
        return 0;
      };
      const sorted = [...nodes].sort((a, b) => {
        const va = getValue(a); const vb = getValue(b);
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb as string, 'ru') : (vb as string).localeCompare(va, 'ru');
        return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
      });
      return sorted.map((n) => ({ ...n, children: n.children?.length ? sortNodes(n.children) : [] }));
    }
    let tree = sortNodes(data.tree);
    const q = search.trim().toLowerCase();
    if (q) {
      // Фильтр: оставляем узлы у которых сам узел или какой-то потомок имеет имя ⊃ q
      function filterNode(n: any): any | null {
        const nameMatch = n.name.toLowerCase().includes(q);
        const kids = (n.children || []).map(filterNode).filter(Boolean);
        if (nameMatch || kids.length > 0) return { ...n, children: kids };
        return null;
      }
      tree = tree.map(filterNode).filter(Boolean) as any[];
    }
    return tree;
  }, [data, sortKey, sortDir, search]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const t = data.totals;
  const deltaRev = t.revenue - t.prevRevenue;
  const deltaPct = t.prevRevenue > 0 ? (deltaRev / t.prevRevenue) * 100 : 0;
  const deltaArr = deltaRev > 0 ? '↑' : deltaRev < 0 ? '↓' : '→';
  const deltaColor = deltaRev > 0 ? 'text-emerald-700' : deltaRev < 0 ? 'text-rose-700' : 'text-gray-500';

  // Pie данные — корни первого уровня
  const pieData = data.tree.map((n: any) => ({ name: n.name, value: n.revenue }));

  const SortHeader = ({ label, k, align = 'right' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => {
    const active = k === sortKey;
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
        <Kpi label="Категорий активных" value={data.tree.length.toLocaleString('ru-RU')} />
        <Kpi label="Отгружено" value={fmtCompact(t.quantity)} suffix="кг"
             sub={t.prevQuantity > 0 ? `${((t.quantity/t.prevQuantity - 1) * 100).toFixed(1)}% к прошл.` : ''} />
        <Kpi label="Выручка" value={fmtCompact(t.revenue)} suffix="₸" sub={`${fmt(t.avgPrice)} ₸/кг ср.`} />
        <Kpi
          label={`vs прошл. период`}
          value={`${deltaArr} ${fmtCompact(Math.abs(deltaRev))}`}
          suffix="₸"
          sub={t.prevRevenue > 0 ? `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : 'нет базы'}
          colorClass={deltaColor}
        />
        <Kpi label="Валовая прибыль" value={fmtCompact(t.profit)} suffix="₸"
             sub={`${(t.margin * 100).toFixed(1)}% маржа`}
             color={t.profit > 0 ? 'green' : 'red'} />
      </div>

      <div className="panel p-3 text-xs text-gray-600 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold">Период:</span> {format(new Date(data.from), 'd MMM yyyy')} → {format(new Date(data.to), 'd MMM yyyy')}
        </div>
        <div className="text-gray-500">
          <span className="font-semibold">vs Прошлый:</span> {format(new Date(data.prevFrom), 'd MMM yyyy')} → {format(new Date(data.prevTo), 'd MMM yyyy')}
        </div>
      </div>

      {/* Pie chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="panel lg:col-span-1">
          <div className="panel-header"><div className="panel-title">Доли выручки (корни)</div></div>
          <div className="p-3">
            <PieBreakdown data={pieData} height={300} />
          </div>
        </div>

        <div className="panel lg:col-span-2 p-4">
          <div className="text-sm font-semibold text-gray-800 mb-2">Лидеры роста / снижения</div>
          {(() => {
            // Берём все категории (включая подкатегории, не только корни) с базой
            // предыдущего периода — иначе на корнях остаётся всего 5-10 строк
            // и top-10 фактически не наберётся.
            const all: any[] = [];
            function walk(nodes: any[]) {
              for (const n of nodes) {
                if (n.prevRevenue > 0) all.push(n);
                if (n.children?.length) walk(n.children);
              }
            }
            walk(data.tree);
            const ups = [...all].sort((a, b) => b.deltaRevenuePct - a.deltaRevenuePct).slice(0, 10);
            const downs = [...all].sort((a, b) => a.deltaRevenuePct - b.deltaRevenuePct).slice(0, 10);
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-emerald-600 mb-1">↑ топ-10 роста</div>
                  {ups.map((n: any, i: number) => (
                    <div key={n.id} className="flex items-baseline gap-2 text-xs py-0.5">
                      <span className="text-gray-400 w-4 text-right tabular-nums">{i + 1}.</span>
                      <span className="flex-1 truncate text-gray-800" title={n.name}>{n.name}</span>
                      <span className="text-emerald-700 font-semibold tabular-nums">+{n.deltaRevenuePct.toFixed(0)}%</span>
                      <span className="text-gray-500 text-[10px] tabular-nums">{fmtCompact(n.revenue)} ₸</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-rose-600 mb-1">↓ топ-10 падения</div>
                  {downs.map((n: any, i: number) => (
                    <div key={n.id} className="flex items-baseline gap-2 text-xs py-0.5">
                      <span className="text-gray-400 w-4 text-right tabular-nums">{i + 1}.</span>
                      <span className="flex-1 truncate text-gray-800" title={n.name}>{n.name}</span>
                      <span className="text-rose-700 font-semibold tabular-nums">{n.deltaRevenuePct.toFixed(0)}%</span>
                      <span className="text-gray-500 text-[10px] tabular-nums">{fmtCompact(n.revenue)} ₸</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Filters */}
      <div className="panel p-3 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Поиск категории…"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px] focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button onClick={expandAll} className="text-xs text-brand-600 hover:underline">Развернуть всё</button>
        <span className="text-gray-300">·</span>
        <button onClick={collapseAll} className="text-xs text-brand-600 hover:underline">Свернуть всё</button>
        {search && (
          <button onClick={() => setSearch('')} className="ml-auto text-xs text-brand-600 hover:underline">Сбросить ×</button>
        )}
      </div>

      {/* Tree table */}
      <div className="panel">
        <div className="max-h-[72vh] overflow-auto">
          <table className="report w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
              <tr>
                <SortHeader label="Категория" k="name" align="left" />
                <SortHeader label="SKU" k="sku" />
                <SortHeader label="КГ" k="kg" />
                <SortHeader label="₸/кг" k="avgPrice" />
                <SortHeader label="Выручка" k="revenue" />
                <th className="text-right w-44">Доля</th>
                <SortHeader label="Δ vs прошл." k="delta" />
                <SortHeader label="Себестоимость" k="cost" />
                <SortHeader label="Прибыль" k="profit" />
                <SortHeader label="Маржа" k="margin" />
              </tr>
            </thead>
            <tbody>
              {sortedTree.length === 0 && (
                <tr><td colSpan={10} className="text-center text-gray-500 py-8">Нет данных</td></tr>
              )}
              {sortedTree.map((n: any) => (
                <TreeRow key={n.id} n={n} expanded={expanded} toggle={toggle} totalRev={t.revenue} onDrill={openDrill} />
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-brand-50 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
              <tr className="font-semibold border-t-2 border-brand-200">
                <td className="text-right uppercase tracking-wider text-brand-700 text-xs">ИТОГО</td>
                <td className="num text-xs"></td>
                <td className="num">{fmtKg(t.quantity)}</td>
                <td className="num text-xs">{fmt(t.avgPrice)}</td>
                <td className="num">{fmt(t.revenue)}</td>
                <td className="num text-xs">100%</td>
                <td className={'num text-xs ' + deltaColor}>
                  {t.prevRevenue > 0 ? `${deltaArr} ${deltaPct.toFixed(1)}%` : '—'}
                </td>
                <td className="num text-xs text-gray-600">{fmt(t.cost)}</td>
                <td className={'num ' + (t.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(t.profit)}</td>
                <td className="num text-xs">{(t.margin * 100).toFixed(1)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 Источники</div>
        <div className="space-y-1">
          <div><b>Источник</b>: <code>RealizaciaItem</code> ← <code>Realizacia</code> (1С Расходная накладная). Заказы не учитываются — только фактическая отгрузка.</div>
          <div><b>Категории</b>: <code>Catalog_КатегорииНоменклатуры</code> 1С. Связь через <code>Nomenclature.categoryId</code>. Иерархия — через <code>parentId</code>.</div>
          <div><b>Себестоимость</b>: масштабированная FIFO через <code>factCost/totalCost</code> родительской реализации — точное соответствие 1С.</div>
          <div><b>КГ</b>: <code>quantity</code> из накладной. Все товары весовые.</div>
          <div><b>Δ vs прошл.</b>: изменение выручки vs предыдущий период такого же размера.</div>
          <div><b>Клик по категории</b> → список SKU.</div>
        </div>
      </div>

      {/* Drill-down */}
      {drillCat && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDrillCat(null)}>
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 sticky top-0 bg-white z-10 flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-lg">{drillCat.name}</h3>
                <div className="text-xs text-gray-500 mt-0.5">
                  {format(new Date(data.from), 'd MMM yyyy')} → {format(new Date(data.to), 'd MMM yyyy')}
                  · {fmtKg(drillCat.quantity)} кг · {fmtCompact(drillCat.revenue)} ₸ · маржа {(drillCat.margin * 100).toFixed(1)}%
                </div>
              </div>
              <button onClick={() => setDrillCat(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            <div className="p-4">
              {drillLoading ? <div className="text-sm text-gray-500">Загрузка…</div> :
                drillData.length === 0 ? <div className="text-sm text-gray-500">Нет SKU напрямую в этой категории (см. подкатегории)</div> : (
                <table className="report w-full">
                  <thead>
                    <tr>
                      <th className="text-left">SKU</th>
                      <th className="text-right">КГ</th>
                      <th className="text-right">₸/кг</th>
                      <th className="text-right">Выручка</th>
                      <th className="text-right">Прибыль</th>
                      <th className="text-right">Маржа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillData.map((s) => (
                      <tr key={s.nomenclatureId}>
                        <td className="text-xs">{s.name}</td>
                        <td className="num text-xs">{fmtKg(s.quantity)}</td>
                        <td className="num text-xs text-gray-600">{fmt(s.avgPrice)}</td>
                        <td className="num">{fmt(s.revenue)}</td>
                        <td className={'num text-xs ' + (s.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(s.profit)}</td>
                        <td className="num text-xs">{(s.margin * 100).toFixed(1)}%</td>
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

function TreeRow({ n, expanded, toggle, totalRev, onDrill }:
  { n: any; expanded: Set<string>; toggle: (id: string) => void; totalRev: number; onDrill: (n: any) => void }) {
  const isOpen = expanded.has(n.id);
  const hasChildren = n.children && n.children.length > 0;
  const pct = totalRev > 0 ? (n.revenue / totalRev) * 100 : 0;
  const dArr = n.deltaRevenuePct > 0 ? '↑' : n.deltaRevenuePct < 0 ? '↓' : '→';
  const dColor = n.deltaRevenuePct > 0 ? 'text-emerald-700' : n.deltaRevenuePct < 0 ? 'text-rose-700' : 'text-gray-400';
  return (
    <>
      <tr className={'hover:bg-gray-50 ' + (n.depth === 0 ? 'font-semibold' : '')}>
        <td>
          <div className="flex items-center gap-1.5" style={{ paddingLeft: `${n.depth * 18}px` }}>
            {hasChildren ? (
              <button onClick={() => toggle(n.id)} className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700">
                <IconChevronDown width={12} height={12} className={'transition-transform ' + (isOpen ? '' : '-rotate-90')} />
              </button>
            ) : <span className="w-4" />}
            <button
              onClick={() => onDrill(n)}
              className={'text-left hover:text-brand-700 hover:underline ' + (hasChildren ? 'font-medium' : 'text-gray-700')}
            >
              {n.name}
            </button>
            {hasChildren && <span className="text-[10px] text-gray-400 ml-1">({n.children.length})</span>}
          </div>
        </td>
        <td className="num text-xs text-gray-500">{n.skuCount || ''}</td>
        <td className="num text-xs">{fmtKg(n.quantity)}</td>
        <td className="num text-xs text-gray-600">{fmt(n.avgPrice)}</td>
        <td className="num">{fmt(n.revenue)}</td>
        <td className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <div className="h-1.5 w-20 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-12 text-right">{pct.toFixed(1)}%</span>
          </div>
        </td>
        <td className={'num text-xs ' + dColor}>
          {n.prevRevenue > 0 ? `${dArr} ${Math.abs(n.deltaRevenuePct).toFixed(0)}%` : <span className="text-gray-300">—</span>}
        </td>
        <td className="num text-xs text-gray-500">{fmt(n.cost)}</td>
        <td className={'num ' + (n.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(n.profit)}</td>
        <td className="num text-xs">{(n.margin * 100).toFixed(1)}%</td>
      </tr>
      {isOpen && hasChildren && n.children.map((c: any) => (
        <TreeRow key={c.id} n={c} expanded={expanded} toggle={toggle} totalRev={totalRev} onDrill={onDrill} />
      ))}
    </>
  );
}

function Kpi({ label, value, suffix, sub, color, colorClass }: any) {
  const c = colorClass || (color === 'green' ? 'text-emerald-700' : color === 'red' ? 'text-rose-700' : 'text-gray-900');
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

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { IconChevronDown } from './Icons';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return String(Math.round(n));
};

export default function CategoryTreeClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial.tree.slice(0, 8).map((n: any) => n.id)));

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/by-category?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

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
  function collapseAll() {
    setExpanded(new Set());
  }

  const totals = data.totals;
  const maxRev = data.tree[0]?.revenue || 1;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card"><div className="kpi-label">Выручка</div><div className="kpi-value">{fmt(totals.revenue)} <span className="text-base text-gray-500">₸</span></div></div>
        <div className="kpi-card"><div className="kpi-label">Количество</div><div className="kpi-value">{fmt(totals.quantity)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Себестоимость</div><div className="kpi-value text-gray-500">{fmt(totals.cost)} <span className="text-base">₸</span></div></div>
        <div className="kpi-card"><div className="kpi-label">Валовая прибыль</div><div className={'kpi-value ' + (totals.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(totals.profit)} <span className="text-base text-gray-500">₸</span></div>
          <div className="text-xs text-gray-500">{totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : '0'}% маржа</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Дерево категорий</div>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={expandAll} className="text-brand-600 hover:underline">Развернуть всё</button>
            <span className="text-gray-300">·</span>
            <button onClick={collapseAll} className="text-brand-600 hover:underline">Свернуть всё</button>
          </div>
        </div>
        <div className="overflow-auto">
          <table className="report">
            <thead>
              <tr>
                <th>Категория</th>
                <th className="text-right">Кол-во</th>
                <th className="text-right">Выручка</th>
                <th className="text-right w-40">Доля</th>
                <th className="text-right">Себестоимость</th>
                <th className="text-right">Валовая прибыль</th>
                <th className="text-right">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {data.tree.map((n: any) => (
                <TreeRow key={n.id} n={n} expanded={expanded} toggle={toggle} maxRev={maxRev} totalRev={totals.revenue} />
              ))}
              {data.tree.length === 0 && (
                <tr><td colSpan={7} className="text-center text-gray-500 py-8">Нет данных</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="total">
                <td>Итого</td>
                <td className="num">{fmt(totals.quantity)}</td>
                <td className="num">{fmt(totals.revenue)}</td>
                <td></td>
                <td className="num">{fmt(totals.cost)}</td>
                <td className="num">{fmt(totals.profit)}</td>
                <td className="num">{totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : '0'}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function TreeRow({ n, expanded, toggle, maxRev, totalRev }:
  { n: any; expanded: Set<string>; toggle: (id: string) => void; maxRev: number; totalRev: number }) {
  const isOpen = expanded.has(n.id);
  const hasChildren = n.children && n.children.length > 0;
  const pct = totalRev > 0 ? (n.revenue / totalRev) * 100 : 0;
  const barPct = maxRev > 0 ? (n.revenue / maxRev) * 100 : 0;
  return (
    <>
      <tr className={n.depth === 0 ? 'font-semibold' : ''}>
        <td>
          <div className="flex items-center gap-1" style={{ paddingLeft: `${n.depth * 16}px` }}>
            {hasChildren ? (
              <button onClick={() => toggle(n.id)} className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-700">
                <IconChevronDown width={12} height={12} className={'transition-transform ' + (isOpen ? '' : '-rotate-90')} />
              </button>
            ) : <span className="w-4" />}
            <span className={n.isFolder ? 'font-medium' : 'text-gray-700'}>{n.name}</span>
            {hasChildren && <span className="text-[10px] text-gray-400 ml-1">({n.children.length})</span>}
          </div>
        </td>
        <td className="num text-xs">{fmt(n.quantity)}</td>
        <td className="num">{fmt(n.revenue)}</td>
        <td className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${barPct}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-12">{pct.toFixed(1)}%</span>
          </div>
        </td>
        <td className="num text-xs text-gray-500">{fmt(n.cost)}</td>
        <td className={'num ' + (n.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(n.profit)}</td>
        <td className="num text-xs">{(n.margin * 100).toFixed(1)}%</td>
      </tr>
      {isOpen && hasChildren && n.children.map((c: any) => (
        <TreeRow key={c.id} n={c} expanded={expanded} toggle={toggle} maxRev={maxRev} totalRev={totalRev} />
      ))}
    </>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

type View = 'contractor' | 'item' | 'manager';

export default function DiscountsClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('contractor');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch('/api/discounts?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  const rows = useMemo(() => {
    if (!data) return [];
    const src = view === 'contractor' ? data.byContractor : view === 'item' ? data.byItem : data.byManager;
    const q = search.trim().toLowerCase();
    if (!q) return src;
    return src.filter((r: any) => r.name.toLowerCase().includes(q));
  }, [data, view, search]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const t = data.totals;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Скидок выдано" value={fmt(t.discount) + ' ₸'} color="amber" />
        <Kpi label="% от валовой выручки" value={t.pct.toFixed(2) + '%'} color="amber" />
        <Kpi label="Документов" value={fmt(t.documentsCount)} sub={`${fmt(t.itemsCount)} позиций`} />
        <Kpi label="Чистая выручка" value={fmt(t.revenue) + ' ₸'} />
      </div>

      <div className="panel">
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="toggle-group">
            <button onClick={() => setView('contractor')} className={'toggle-btn ' + (view === 'contractor' ? 'toggle-btn-active' : '')}>По контрагентам</button>
            <button onClick={() => setView('item')} className={'toggle-btn ' + (view === 'item' ? 'toggle-btn-active' : '')}>По позициям</button>
            <button onClick={() => setView('manager')} className={'toggle-btn ' + (view === 'manager' ? 'toggle-btn-active' : '')}>По менеджерам</button>
          </div>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px]"
          />
          <div className="text-xs text-gray-500">Показано {rows.length}</div>
        </div>
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>{view === 'contractor' ? 'Контрагент' : view === 'item' ? 'Позиция' : 'Менеджер'}</th>
              {view === 'contractor' && <th className="text-right">Документов</th>}
              <th className="text-right">Сумма скидки</th>
              <th className="text-right">Чистая выручка</th>
              <th className="text-right">% скидки</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={view === 'contractor' ? 6 : 5} className="text-center text-gray-500 py-8">Нет данных</td></tr>
            )}
            {rows.slice(0, 500).map((r: any, i: number) => (
              <tr key={i}>
                <td className="text-gray-400 text-xs">{i + 1}</td>
                <td className="text-sm">{r.name}</td>
                {view === 'contractor' && <td className="num text-xs text-gray-500">{fmt(r.documentsCount)}</td>}
                <td className="num font-semibold text-amber-700">{fmt(r.discountSum)}</td>
                <td className="num text-xs">{fmt(r.revenue)}</td>
                <td className="num text-xs">
                  <span className={r.pct > 10 ? 'text-rose-700 font-medium' : r.pct > 5 ? 'text-amber-700' : 'text-gray-600'}>
                    {r.pct.toFixed(2)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 500 && (
            <tfoot><tr><td colSpan={6} className="text-xs text-gray-500 text-center py-2">…показано первых 500</td></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, color, sub }: any) {
  const cls = color === 'amber' ? 'text-amber-700' : color === 'green' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

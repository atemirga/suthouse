'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

export default function SkuPivotClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [metric, setMetric] = useState<'revenue' | 'qty'>('revenue');

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/by-sku?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r: any) => r.name.toLowerCase().includes(q));
  }, [data, search]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Выручка" value={fmt(data.totals.revenue) + ' ₸'} />
        <Kpi label="Себестоимость" value={fmt(data.totals.cost) + ' ₸'} />
        <Kpi label="Валовая прибыль" value={fmt(data.totals.profit) + ' ₸'} color={data.totals.profit > 0 ? 'green' : 'red'} />
        <Kpi label="SKU в отчёте" value={String(data.rows.length)} />
      </div>

      <div className="panel">
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по позиции…"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px]"
          />
          <div className="text-xs text-gray-500">
            Показано {filteredRows.length} из {data.rows.length}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-gray-500 uppercase tracking-wider">Значение:</span>
            <div className="toggle-group">
              <button onClick={() => setMetric('revenue')} className={'toggle-btn ' + (metric === 'revenue' ? 'toggle-btn-active' : '')}>Выручка</button>
              <button onClick={() => setMetric('qty')} className={'toggle-btn ' + (metric === 'qty' ? 'toggle-btn-active' : '')}>Кол-во</button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel overflow-auto">
        <table className="report" style={{ minWidth: 600 + data.managers.length * 140 }}>
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th style={{ position: 'sticky', left: 0, background: '#f9fafb', zIndex: 1 }}>Позиция</th>
              {data.managers.map((m: string) => (
                <th key={m} className="text-right whitespace-nowrap">{m}</th>
              ))}
              <th className="text-right whitespace-nowrap bg-brand-50">Итого</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr><td colSpan={data.managers.length + 3} className="text-center text-gray-500 py-8">Нет данных</td></tr>
            )}
            {filteredRows.map((r: any, i: number) => {
              const total = metric === 'revenue' ? r.totalRevenue : r.totalQuantity;
              return (
                <tr key={i}>
                  <td className="text-gray-400 text-xs">{i + 1}</td>
                  <td className="text-xs" style={{ position: 'sticky', left: 0, background: '#fff' }}>{r.name}</td>
                  {data.managers.map((m: string) => {
                    const v = r.byManager[m];
                    const val = v ? (metric === 'revenue' ? v.revenue : v.qty) : 0;
                    return (
                      <td key={m} className="num text-xs">
                        {val > 0 ? fmt(val) : <span className="text-gray-300">—</span>}
                      </td>
                    );
                  })}
                  <td className="num font-semibold bg-brand-50/60">{fmt(total)}</td>
                </tr>
              );
            })}
          </tbody>
          {filteredRows.length > 0 && (
            <tfoot>
              <tr className="total">
                <td colSpan={2}>Итого</td>
                {data.managers.map((m: string) => {
                  const v = data.totals.byManager[m];
                  const val = v ? (metric === 'revenue' ? v.revenue : v.qty) : 0;
                  return <td key={m} className="num">{fmt(val)}</td>;
                })}
                <td className="num">{fmt(metric === 'revenue' ? data.totals.revenue : data.totals.quantity)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }) {
  const cls = color === 'green' ? 'text-emerald-700' : color === 'red' ? 'text-rose-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>{value}</div>
    </div>
  );
}

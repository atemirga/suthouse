'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

export default function KassaClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'kassa' | 'bank'>('all');

  useEffect(() => {
    setLoading(true);
    fetch('/api/dds/by-kassa?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const rows = filter === 'all' ? data.rows : data.rows.filter((r: any) => r.type === filter);
  const t = data.totals;

  // Re-compute totals for filter
  const ft = filter === 'all' ? t : {
    openingBalance: rows.reduce((s: number, r: any) => s + r.openingBalance, 0),
    inflow: rows.reduce((s: number, r: any) => s + r.inflow, 0),
    outflow: rows.reduce((s: number, r: any) => s + r.outflow, 0),
    closingBalance: rows.reduce((s: number, r: any) => s + r.closingBalance, 0),
  };

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Начальный остаток" value={fmt(ft.openingBalance) + ' ₸'} />
        <Kpi label="Поступления" value={fmt(ft.inflow) + ' ₸'} color="green" />
        <Kpi label="Расход" value={fmt(ft.outflow) + ' ₸'} color="red" />
        <Kpi label="Конечный остаток" value={fmt(ft.closingBalance) + ' ₸'} bold />
      </div>

      <div className="panel">
        <div className="px-4 py-3 flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">Тип:</span>
          <div className="toggle-group">
            <button onClick={() => setFilter('all')} className={'toggle-btn ' + (filter === 'all' ? 'toggle-btn-active' : '')}>Всё</button>
            <button onClick={() => setFilter('kassa')} className={'toggle-btn ' + (filter === 'kassa' ? 'toggle-btn-active' : '')}>Кассы</button>
            <button onClick={() => setFilter('bank')} className={'toggle-btn ' + (filter === 'bank' ? 'toggle-btn-active' : '')}>Банк</button>
          </div>
        </div>
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th>Касса/Счёт</th>
              <th>Тип</th>
              <th className="text-right">Начальный остаток</th>
              <th className="text-right">Поступление</th>
              <th className="text-right">Расход</th>
              <th className="text-right">Конечный остаток</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-500 py-8">Нет данных</td></tr>
            )}
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}</td>
                <td>
                  <span className={'pill ' + (r.type === 'bank' ? 'pill-blue' : 'pill-green')}>
                    {r.type === 'bank' ? 'Банк' : 'Касса'}
                  </span>
                </td>
                <td className={'num ' + (r.openingBalance < 0 ? 'text-rose-700' : '')}>{fmt(r.openingBalance)}</td>
                <td className="num text-emerald-700">{r.inflow > 0 ? fmt(r.inflow) : '—'}</td>
                <td className="num text-rose-700">{r.outflow > 0 ? fmt(r.outflow) : '—'}</td>
                <td className={'num font-semibold ' + (r.closingBalance < 0 ? 'text-rose-700' : '')}>{fmt(r.closingBalance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total">
              <td colSpan={2}>Итого</td>
              <td className="num">{fmt(ft.openingBalance)}</td>
              <td className="num">{fmt(ft.inflow)}</td>
              <td className="num">{fmt(ft.outflow)}</td>
              <td className="num">{fmt(ft.closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, color, bold }: any) {
  const cls = color === 'green' ? 'text-emerald-700' : color === 'red' ? 'text-rose-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls + (bold ? ' font-extrabold' : '')}>{value}</div>
    </div>
  );
}

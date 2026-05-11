'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return String(Math.round(n));
};

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#a855f7'];

export default function ManagersClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/by-manager?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const t = data.totals;
  const maxRev = data.rows[0]?.salesAmount || 1;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card"><div className="kpi-label">Заказы</div><div className="kpi-value">{fmt(t.ordersCount)}</div><div className="text-xs text-gray-500">на {fmt(t.ordersAmount)} ₸</div></div>
        <div className="kpi-card"><div className="kpi-label">Отгружено</div><div className="kpi-value">{fmt(t.salesCount)}</div><div className="text-xs text-gray-500">на {fmt(t.salesAmount)} ₸</div></div>
        <div className="kpi-card"><div className="kpi-label">Валовая прибыль</div><div className={'kpi-value ' + (t.salesProfit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmtCompact(t.salesProfit)} ₸</div></div>
        <div className="kpi-card"><div className="kpi-label">Менеджеров</div><div className="kpi-value">{data.rows.length}</div></div>
      </div>

      {/* Cards by manager */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.rows.map((m: any, i: number) => {
          const c = COLORS[i % COLORS.length];
          const pct = (m.salesAmount / maxRev) * 100;
          return (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ background: c }}>
                  {m.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{m.name}</div>
                  <div className="text-xs text-gray-500">
                    {m.ordersCount} заказов · {m.salesCount} отгрузок
                  </div>
                </div>
              </div>
              <div className="text-2xl font-bold tabular-nums">{fmtCompact(m.salesAmount)} <span className="text-base text-gray-500">₸</span></div>
              <div className="text-xs text-gray-500 mb-2">выручка по отгрузкам</div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-gray-500">Ср. чек</div><div className="font-semibold">{fmtCompact(m.avgCheck)} ₸</div></div>
                <div><div className="text-gray-500">Маржа</div><div className={'font-semibold ' + (m.salesMargin > 0 ? 'text-emerald-700' : 'text-rose-700')}>{(m.salesMargin * 100).toFixed(1)}%</div></div>
                <div><div className="text-gray-500">Заказы</div><div className="font-semibold">{fmtCompact(m.ordersAmount)} ₸</div></div>
                <div><div className="text-gray-500">Оплата</div><div className="font-semibold">{(m.conversion * 100).toFixed(0)}%</div></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th>Менеджер</th>
              <th className="text-right">Заказы (шт)</th>
              <th className="text-right">Заказы (₸)</th>
              <th className="text-right">Оплачено (₸)</th>
              <th className="text-right">Отгрузки (шт)</th>
              <th className="text-right">Выручка (₸)</th>
              <th className="text-right">Себестоимость</th>
              <th className="text-right">Прибыль</th>
              <th className="text-right">Маржа</th>
              <th className="text-right">Ср. чек</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((m: any, i: number) => (
              <tr key={i}>
                <td className="font-medium">{m.name}</td>
                <td className="num">{fmt(m.ordersCount)}</td>
                <td className="num">{fmt(m.ordersAmount)}</td>
                <td className="num text-xs">{fmt(m.ordersPaid)}</td>
                <td className="num">{fmt(m.salesCount)}</td>
                <td className="num font-semibold">{fmt(m.salesAmount)}</td>
                <td className="num text-xs text-gray-500">{fmt(m.salesCost)}</td>
                <td className={'num ' + (m.salesProfit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(m.salesProfit)}</td>
                <td className="num text-xs">{(m.salesMargin * 100).toFixed(1)}%</td>
                <td className="num text-xs">{fmt(m.avgCheck)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total">
              <td>Итого</td>
              <td className="num">{fmt(t.ordersCount)}</td>
              <td className="num">{fmt(t.ordersAmount)}</td>
              <td className="num">{fmt(t.ordersPaid)}</td>
              <td className="num">{fmt(t.salesCount)}</td>
              <td className="num">{fmt(t.salesAmount)}</td>
              <td className="num">{fmt(t.salesCost)}</td>
              <td className="num">{fmt(t.salesProfit)}</td>
              <td className="num">{t.salesAmount > 0 ? ((t.salesProfit / t.salesAmount) * 100).toFixed(1) + '%' : '0%'}</td>
              <td className="num">{t.salesCount > 0 ? fmt(t.salesAmount / t.salesCount) : '0'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

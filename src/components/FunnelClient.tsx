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

const SOURCE_COLORS: Record<string, string> = {
  Instagram: '#ec4899', 'Tik-tok': '#0ea5e9', OLX: '#84cc16',
  'Сарафан': '#f59e0b', 'Ютуб': '#ef4444',
};
function colorFor(name: string) {
  return SOURCE_COLORS[name] || '#94a3b8';
}

export default function FunnelClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/funnel?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const t = data.totals;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Контрагентов" value={fmt(t.contractors)} sub={`${data.rows.length} источников`} />
        <Kpi label="С заказом" value={fmt(t.withOrder)} sub={`${t.convOrder.toFixed(1)}% конверсия`} color="amber" />
        <Kpi label="Совершили продажу" value={fmt(t.withSale)} sub={`${t.convSale.toFixed(1)}% от заказов`} color="green" />
        <Kpi label="Выручка" value={fmtCompact(t.revenue) + ' ₸'} sub={`Ср. чек: ${fmtCompact(t.avgCheck)} ₸`} bold />
      </div>

      {/* Funnel visual: 4 ступени */}
      <div className="panel">
        <div className="panel-header"><div className="panel-title">Этапы воронки</div></div>
        <div className="p-6 space-y-3">
          <FunnelStage label="Контрагенты с источником" value={t.contractors} max={t.contractors} color="#3b82f6" />
          <FunnelStage label="С заказом" value={t.withOrder} max={t.contractors} color="#f59e0b" pct={t.convOrder} />
          <FunnelStage label="Совершили продажу" value={t.withSale} max={t.contractors} color="#10b981" pct={t.convSale} fromAbove />
          <div className="ml-3 text-xs text-gray-500 italic">
            ⚠ Потери (заказали, но не выкупили): <b className="text-rose-700">{fmt(t.losses)}</b> контрагентов · {fmtCompact(t.lossesAmount)} ₸
          </div>
        </div>
      </div>

      {/* By source — карточки */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.rows.map((r: any, i: number) => {
          const c = colorFor(r.sourceName);
          return (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                  <div className="font-semibold">{r.sourceName}</div>
                </div>
                <div className="text-xs text-gray-500">{r.contractors} контр.</div>
              </div>
              <div className="text-2xl font-bold tabular-nums mb-1">{fmtCompact(r.revenue)} <span className="text-sm text-gray-500">₸</span></div>
              <div className="text-xs text-gray-500 mb-3">выручка</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-gray-500">С заказом</div><div className="font-semibold">{r.withOrder} <span className="text-gray-400">({r.convOrder.toFixed(0)}%)</span></div></div>
                <div><div className="text-gray-500">Купили</div><div className="font-semibold">{r.withSale} <span className="text-gray-400">({r.convSale.toFixed(0)}%)</span></div></div>
                <div><div className="text-gray-500">Ср. чек</div><div className="font-semibold">{fmtCompact(r.avgCheck)} ₸</div></div>
                <div><div className="text-gray-500">Прибыль</div><div className={'font-semibold ' + (r.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmtCompact(r.profit)} ₸</div></div>
              </div>
              {r.losses > 0 && (
                <div className="mt-2 text-[11px] text-rose-700">⚠ Потеряно {r.losses} клиентов на {fmtCompact(r.lossesAmount)} ₸</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th>Источник</th>
              <th className="text-right">Контрагенты</th>
              <th className="text-right">С заказом</th>
              <th className="text-right">Совершили</th>
              <th className="text-right">Конв.заказ</th>
              <th className="text-right">Конв.продажа</th>
              <th className="text-right">Заказов (₸)</th>
              <th className="text-right">Выручка</th>
              <th className="text-right">Ср. чек</th>
              <th className="text-right">Прибыль</th>
              <th className="text-right">Потери (₸)</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any, i: number) => (
              <tr key={i}>
                <td className="font-medium">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: colorFor(r.sourceName) }} />
                    {r.sourceName}
                  </div>
                </td>
                <td className="num">{fmt(r.contractors)}</td>
                <td className="num">{fmt(r.withOrder)}</td>
                <td className="num">{fmt(r.withSale)}</td>
                <td className="num text-xs">{r.convOrder.toFixed(1)}%</td>
                <td className="num text-xs">{r.convSale.toFixed(1)}%</td>
                <td className="num text-xs text-gray-500">{fmt(r.ordersAmount)}</td>
                <td className="num font-semibold">{fmt(r.revenue)}</td>
                <td className="num text-xs">{fmt(r.avgCheck)}</td>
                <td className={'num ' + (r.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(r.profit)}</td>
                <td className="num text-xs text-rose-700">{r.lossesAmount > 0 ? fmt(r.lossesAmount) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="total">
              <td>Итого</td>
              <td className="num">{fmt(t.contractors)}</td>
              <td className="num">{fmt(t.withOrder)}</td>
              <td className="num">{fmt(t.withSale)}</td>
              <td className="num">{t.convOrder.toFixed(1)}%</td>
              <td className="num">{t.convSale.toFixed(1)}%</td>
              <td className="num">{fmt(t.ordersAmount)}</td>
              <td className="num">{fmt(t.revenue)}</td>
              <td className="num">{fmt(t.avgCheck)}</td>
              <td className="num">{fmt(t.profit)}</td>
              <td className="num">{fmt(t.lossesAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function FunnelStage({ label, value, max, color, pct, fromAbove }:
  { label: string; value: number; max: number; color: string; pct?: number; fromAbove?: boolean }) {
  const widthPct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm">
          <b>{fmt(value)}</b>
          {pct !== undefined && <span className="text-xs text-gray-500 ml-2">{fromAbove ? `${pct.toFixed(1)}% от пред.` : `${pct.toFixed(1)}%`}</span>}
        </span>
      </div>
      <div className="h-7 rounded-md bg-gray-100 overflow-hidden relative">
        <div className="h-full rounded-md transition-all" style={{ width: `${widthPct}%`, background: color }} />
      </div>
    </div>
  );
}

function Kpi({ label, value, color, sub, bold }: any) {
  const cls = color === 'green' ? 'text-emerald-700' : color === 'amber' ? 'text-amber-700' : color === 'red' ? 'text-rose-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls + (bold ? ' font-extrabold' : '')}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

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

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#a855f7', '#14b8a6', '#ef4444', '#22c55e', '#eab308', '#0ea5e9', '#a3a3a3', '#6b7280'];

interface PackerRow {
  name: string;
  ordersCount: number;
  ordersAmount: number;
  avgOrder: number;
  share: number;
}

interface Data {
  from: string;
  to: string;
  totals: { ordersCount: number; ordersAmount: number };
  rows: PackerRow[];
}

export default function PackersClient({ initial }: { initial: Data }) {
  const sp = useSearchParams();
  const [data, setData] = useState<Data | null>(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/packers?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const t = data.totals;
  const maxCount = data.rows[0]?.ordersCount || 1;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Заказов упаковано</div>
          <div className="kpi-value">{fmt(t.ordersCount)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">На сумму</div>
          <div className="kpi-value">{fmtCompact(t.ordersAmount)} <span className="text-base text-gray-500">₸</span></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Упаковщиков</div>
          <div className="kpi-value">{data.rows.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Средний заказ</div>
          <div className="kpi-value">{t.ordersCount > 0 ? fmtCompact(t.ordersAmount / t.ordersCount) : '0'} <span className="text-base text-gray-500">₸</span></div>
        </div>
      </div>

      {/* Bar list */}
      <div className="panel">
        <div className="text-sm font-semibold text-gray-800 mb-3">Рейтинг упаковщиков по количеству заказов</div>
        <div className="space-y-2">
          {data.rows.map((p, i) => {
            const c = COLORS[i % COLORS.length];
            const widthPct = (p.ordersCount / maxCount) * 100;
            return (
              <div key={p.name} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: c }}>
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="w-44 truncate text-sm font-medium">{p.name}</div>
                <div className="flex-1 h-6 bg-gray-100 rounded relative overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${widthPct}%`, background: c, opacity: 0.85 }} />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-medium text-gray-900">
                    {p.ordersCount} ({(p.share * 100).toFixed(1)}%)
                  </div>
                </div>
                <div className="w-32 text-right text-sm tabular-nums text-gray-700">{fmtCompact(p.ordersAmount)} ₸</div>
                <div className="w-28 text-right text-xs tabular-nums text-gray-500">{fmtCompact(p.avgOrder)} / зак.</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Упаковщик</th>
              <th className="px-2 py-2 text-right">Заказов</th>
              <th className="px-2 py-2 text-right">Доля</th>
              <th className="px-2 py-2 text-right">Сумма, ₸</th>
              <th className="px-2 py-2 text-right">Средний заказ, ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((p, i) => (
              <tr key={p.name} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                <td className="px-2 py-1.5 font-medium">{p.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(p.ordersCount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{(p.share * 100).toFixed(1)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(p.ordersAmount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{fmt(p.avgOrder)}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-gray-50">
              <td className="px-2 py-2"></td>
              <td className="px-2 py-2">Всего</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmt(t.ordersCount)}</td>
              <td className="px-2 py-2 text-right">100%</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmt(t.ordersAmount)}</td>
              <td className="px-2 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

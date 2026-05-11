'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

const CLASS_COLOR: Record<'A' | 'B' | 'C', string> = { A: '#10b981', B: '#f59e0b', C: '#94a3b8' };

export default function PackersClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/packers?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="kpi-card"><div className="kpi-label">Упаковщиков</div><div className="kpi-value">{data.totals.packersCount}</div></div>
        <div className="kpi-card"><div className="kpi-label">Заказов</div><div className="kpi-value">{fmt(data.totals.ordersCount)}</div></div>
        <div className="kpi-card"><div className="kpi-label">Оборот</div><div className="kpi-value">{fmt(data.totals.ordersAmount)} <span className="text-base text-gray-500">₸</span></div></div>
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="w-12">Класс</th>
              <th>Упаковщик</th>
              <th className="text-right">Заказов</th>
              <th className="text-right">Сумма</th>
              <th className="text-right">Доля</th>
              <th className="text-right">Накопл.</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-500 py-8">
                Нет данных. Похоже, поле «Курьер/Упаковщик» в заказах за этот период не заполнено.
              </td></tr>
            )}
            {data.rows.map((r: any, i: number) => (
              <tr key={i}>
                <td className="text-gray-400 text-xs">{i + 1}</td>
                <td>
                  <span className="inline-block w-6 h-6 rounded text-xs font-bold flex items-center justify-center text-white"
                        style={{ background: CLASS_COLOR[r.abcClass as 'A' | 'B' | 'C'] }}>
                    {r.abcClass}
                  </span>
                </td>
                <td className="font-medium">{r.name}</td>
                <td className="num">{fmt(r.ordersCount)}</td>
                <td className="num font-semibold">{fmt(r.ordersAmount)}</td>
                <td className="num text-xs">{r.share.toFixed(1)}%</td>
                <td className="num text-xs text-gray-500">{r.cumShare.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

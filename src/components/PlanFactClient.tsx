'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return String(Math.round(n));
};

const SCOPE_LABELS: Record<string, string> = {
  total: 'Всего', category: 'Категория', sku: 'Позиция', manager: 'Менеджер',
};

export default function PlanFactClient({ initial }: { initial: any }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/plan-fact')
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const t = data.totals;
  const tDelta = t.amountFact - t.amountPlan;
  const tDeltaColor = t.deltaPct >= 100 ? 'text-emerald-700' : t.deltaPct >= 80 ? 'text-amber-700' : 'text-rose-700';

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="План всего" value={fmtCompact(t.amountPlan) + ' ₸'} />
        <Kpi label="Факт всего" value={fmtCompact(t.amountFact) + ' ₸'} bold />
        <Kpi label="Отклонение" value={(tDelta >= 0 ? '+' : '') + fmtCompact(tDelta) + ' ₸'} color={tDelta >= 0 ? 'green' : 'red'} />
        <Kpi label="Выполнение" value={t.deltaPct.toFixed(1) + '%'} color={t.deltaPct >= 100 ? 'green' : t.deltaPct >= 80 ? 'amber' : 'red'} bold />
      </div>

      {data.rows.length === 0 ? (
        <div className="panel p-12 text-center text-gray-500">
          Планов нет. Добавьте на странице <a href="/sales/plans" className="text-brand-600 hover:underline">«Планы продаж»</a>.
        </div>
      ) : (
        <div className="panel overflow-auto">
          <table className="report">
            <thead>
              <tr>
                <th>Сценарий</th>
                <th>Период</th>
                <th>Тип</th>
                <th>Объект</th>
                <th className="text-right">План</th>
                <th className="text-right">Факт</th>
                <th className="text-right">Отклонение</th>
                <th className="text-right w-32">Выполнение</th>
                <th className="text-right">Прогноз</th>
                <th className="text-right">Дни</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: any) => {
                const pctColor = r.amountPct >= 100 ? '#10b981' : r.amountPct >= 80 ? '#f59e0b' : '#ef4444';
                return (
                  <tr key={r.id}>
                    <td className="text-sm font-medium">{r.scenarioName}</td>
                    <td className="text-xs">{format(new Date(r.startDate), 'dd.MM.yy')} — {format(new Date(r.endDate), 'dd.MM.yy')}</td>
                    <td className="text-xs">{SCOPE_LABELS[r.scope] || r.scope}</td>
                    <td className="text-xs">{r.scopeName || (r.scope === 'total' ? 'компания' : '—')}</td>
                    <td className="num">{fmt(r.amountPlan)}</td>
                    <td className="num font-semibold">{fmt(r.amountFact)}</td>
                    <td className={'num ' + (r.amountDelta >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                      {r.amountDelta >= 0 ? '+' : ''}{fmt(r.amountDelta)}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <div className="h-1.5 w-20 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(r.amountPct, 100)}%`, background: pctColor }} />
                        </div>
                        <span className="text-xs font-semibold w-12" style={{ color: pctColor }}>{r.amountPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="num text-xs text-gray-600">{fmt(r.amountForecast)}</td>
                    <td className="num text-xs text-gray-500">{r.daysPassed}/{r.daysTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color, bold }: any) {
  const cls = color === 'green' ? 'text-emerald-700' : color === 'red' ? 'text-rose-700' : color === 'amber' ? 'text-amber-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls + (bold ? ' font-extrabold' : '')}>{value}</div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { PieBreakdown } from './Charts';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return String(Math.round(n));
};

const CLASS_COLOR: Record<'A' | 'B' | 'C', string> = {
  A: '#10b981',
  B: '#f59e0b',
  C: '#94a3b8',
};

export default function AbcClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const param = (sp.get('param') as 'revenue' | 'profit' | 'quantity') || 'revenue';

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/abc?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setParam(v: string) {
    const p = new URLSearchParams(sp.toString());
    p.set('param', v);
    router.push(`${pathname}?${p.toString()}`);
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter((r: any) => {
      if (classFilter !== 'all' && r.abcClass !== classFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, classFilter]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const t = data.totals;
  const cls = data.classCounts;
  const ct = data.classTotals;

  const pieData = (['A', 'B', 'C'] as const).map((c) => ({
    name: `Класс ${c} (${cls[c]} SKU)`,
    value: param === 'revenue' ? ct[c].revenue : param === 'profit' ? ct[c].profit : ct[c].quantity,
  }));

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBlock label="Всего SKU" value={String(t.skuCount)} />
        <KpiBlock label="Выручка" value={fmtCompact(t.revenue)} suffix="₸" />
        <KpiBlock label="Себестоимость" value={fmtCompact(t.cost)} suffix="₸" />
        <KpiBlock label="Валовая прибыль" value={fmtCompact(t.profit)} suffix="₸"
                  sub={t.revenue > 0 ? ((t.profit / t.revenue) * 100).toFixed(1) + '% маржа' : ''}
                  color={t.profit > 0 ? 'green' : 'red'} />
      </div>

      {/* Class summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(['A', 'B', 'C'] as const).map((c) => {
          const count = cls[c];
          const pct = t.skuCount > 0 ? (count / t.skuCount) * 100 : 0;
          const rev = ct[c].revenue;
          const revPct = t.revenue > 0 ? (rev / t.revenue) * 100 : 0;
          return (
            <button
              key={c}
              onClick={() => setClassFilter(classFilter === c ? 'all' : c)}
              className={`text-left p-4 rounded-xl border-2 transition-all bg-white ${
                classFilter === c ? 'shadow-sm' : 'hover:shadow-sm'
              }`}
              style={{ borderColor: classFilter === c ? CLASS_COLOR[c] : '#e5e7eb' }}
            >
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold tabular-nums" style={{ color: CLASS_COLOR[c] }}>{c}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wider">класс</div>
              </div>
              <div className="mt-1 text-sm">
                <span className="font-semibold">{count} SKU</span>
                <span className="text-gray-500"> ({pct.toFixed(1)}%)</span>
              </div>
              <div className="text-xs text-gray-600 mt-1">Выручка: <b>{fmt(rev)} ₸</b> ({revPct.toFixed(1)}%)</div>
              <div className="text-xs text-gray-600">Маржа: {ct[c].revenue > 0 ? ((ct[c].profit / ct[c].revenue) * 100).toFixed(1) : '0'}%</div>
            </button>
          );
        })}
      </div>

      {/* Param selector + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <div className="panel-title">Параметр анализа</div>
            <div className="toggle-group">
              <button onClick={() => setParam('revenue')} className={'toggle-btn ' + (param === 'revenue' ? 'toggle-btn-active' : '')}>Выручка</button>
              <button onClick={() => setParam('profit')} className={'toggle-btn ' + (param === 'profit' ? 'toggle-btn-active' : '')}>Прибыль</button>
              <button onClick={() => setParam('quantity')} className={'toggle-btn ' + (param === 'quantity' ? 'toggle-btn-active' : '')}>Кол-во</button>
            </div>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск SKU…"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px]"
              />
              <div className="text-xs text-gray-500">
                Показано {rows.length} из {data.rows.length}
                {classFilter !== 'all' && (
                  <button onClick={() => setClassFilter('all')} className="ml-2 text-brand-600 hover:underline">Сбросить класс ×</button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">Доля по классам</div>
          </div>
          <div className="p-3">
            <PieBreakdown data={pieData} height={220} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="w-12">Класс</th>
              <th>Номенклатура</th>
              <th className="text-right">Кол-во</th>
              <th className="text-right">Выручка</th>
              <th className="text-right">Себестоимость</th>
              <th className="text-right">Валовая прибыль</th>
              <th className="text-right">Маржа</th>
              <th className="text-right">Доля</th>
              <th className="text-right">Накопл.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="text-center text-gray-500 py-8">Нет данных</td></tr>
            )}
            {rows.slice(0, 500).map((r: any, i: number) => (
              <tr key={i}>
                <td className="text-gray-400 text-xs">{i + 1}</td>
                <td>
                  <span className="inline-block w-6 h-6 rounded text-xs font-bold flex items-center justify-center text-white"
                        style={{ background: CLASS_COLOR[r.abcClass as 'A' | 'B' | 'C'] }}>
                    {r.abcClass}
                  </span>
                </td>
                <td className="text-xs">{r.name}</td>
                <td className="num text-xs">{fmt(r.quantity)}</td>
                <td className="num">{fmt(r.revenue)}</td>
                <td className="num text-xs text-gray-500">{fmt(r.cost)}</td>
                <td className={'num ' + (r.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(r.profit)}</td>
                <td className="num text-xs">{(r.margin * 100).toFixed(1)}%</td>
                <td className="num text-xs">{r.share.toFixed(2)}%</td>
                <td className="num text-xs text-gray-500">{r.cumShare.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 500 && (
            <tfoot><tr><td colSpan={10} className="text-center text-xs text-gray-500 py-2">…показано первых 500. Уточните фильтр для полного просмотра.</td></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function KpiBlock({ label, value, suffix, sub, color }: any) {
  const colorClasses: Record<string, string> = {
    green: 'text-emerald-700',
    red: 'text-rose-700',
  };
  const c = color ? colorClasses[color] : 'text-gray-900';
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

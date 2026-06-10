'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { PieBreakdown } from './Charts';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtKg = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
};

const CLASS_COLOR: Record<'X' | 'Y' | 'Z', string> = {
  X: '#10b981',
  Y: '#f59e0b',
  Z: '#ef4444',
};
const CLASS_BG: Record<'X' | 'Y' | 'Z', string> = {
  X: '#ecfdf5',
  Y: '#fffbeb',
  Z: '#fef2f2',
};
const CLASS_DESC: Record<'X' | 'Y' | 'Z', string> = {
  X: 'CV < 10% — стабильный спрос',
  Y: 'CV 10–25% — умеренные колебания',
  Z: 'CV ≥ 25% или 1 месяц — нестабильно',
};

type Param = 'revenue' | 'quantity';

export default function XyzClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<'all' | 'X' | 'Y' | 'Z'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const param: Param = (sp.get('param') as Param) || 'revenue';

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/xyz?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setParam(v: string) {
    const p = new URLSearchParams(sp.toString());
    p.set('param', v);
    router.push(`${pathname}?${p.toString()}`);
  }

  const categories = useMemo(() => {
    if (!data) return [];
    const s = new Set<string>();
    for (const r of data.rows as any[]) if (r.category) s.add(r.category);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return (data.rows as any[]).filter((r) => {
      if (classFilter !== 'all' && r.xyzClass !== classFilter) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, classFilter, categoryFilter]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const t = data.totals;
  const cls = data.classCounts;
  const ct = data.classTotals;
  const months: string[] = data.months || [];

  const pieData = (['X', 'Y', 'Z'] as const).map((c) => ({
    name: `Класс ${c} (${cls[c]} SKU)`,
    value: param === 'revenue' ? ct[c].revenue : ct[c].quantity,
  }));

  const tooFewMonths = months.length < 2;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {tooFewMonths && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 text-sm">
          <b>Внимание:</b> XYZ-анализ требует минимум 2 месяца. В выбранном периоде —{' '}
          <b>{months.length || 'меньше 1'}</b> месяц
          {months.length === 1 ? '' : 'а'}. Поэтому все SKU автоматически попадают в класс <b>Z</b> и
          карточки X/Y показывают 0. Расширьте период до 3 месяцев и больше — оптимально 6.
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBlock label="Всего SKU" value={t.skuCount.toLocaleString('ru-RU')} />
        <KpiBlock label="Выручка" value={fmtCompact(t.revenue)} suffix="₸" />
        <KpiBlock label="Масса" value={fmtCompact(t.quantity)} suffix="кг" />
        <KpiBlock label="Месяцев в периоде" value={months.length.toLocaleString('ru-RU')} sub={`в среднем SKU продаётся ${t.avgMonths.toFixed(1)} мес`} />
      </div>

      {/* Class cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(['X', 'Y', 'Z'] as const).map((c) => {
          const count = cls[c];
          const pct = t.skuCount > 0 ? (count / t.skuCount) * 100 : 0;
          const val = param === 'revenue' ? ct[c].revenue : ct[c].quantity;
          const totalVal = param === 'revenue' ? t.revenue : t.quantity;
          const valPct = totalVal > 0 ? (val / totalVal) * 100 : 0;
          const active = classFilter === c;
          return (
            <button
              key={c}
              onClick={() => setClassFilter(active ? 'all' : c)}
              className="text-left p-4 rounded-xl border-2 transition-all bg-white hover:shadow-md"
              style={{
                borderColor: active ? CLASS_COLOR[c] : '#e5e7eb',
                background: active ? CLASS_BG[c] : '#fff',
              }}
            >
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-bold tabular-nums" style={{ color: CLASS_COLOR[c] }}>{c}</div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider">класс</div>
                </div>
                {active && <span className="text-[10px] uppercase font-semibold text-gray-500">фильтр</span>}
              </div>
              <div className="mt-1 text-sm">
                <span className="font-semibold">{count} SKU</span>
                <span className="text-gray-500"> ({pct.toFixed(1)}%)</span>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">{CLASS_DESC[c]}</div>
              <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                <div className="flex justify-between"><span>Выручка</span><b>{fmtCompact(ct[c].revenue)} ₸</b></div>
                <div className="flex justify-between"><span>Масса</span><b>{fmtCompact(ct[c].quantity)} кг</b></div>
              </div>
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${valPct.toFixed(1)}%`, background: CLASS_COLOR[c] }}
                />
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">{valPct.toFixed(1)}% от итога</div>
            </button>
          );
        })}
      </div>

      {/* Param selector + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="panel lg:col-span-2 p-4 text-xs text-gray-600 leading-relaxed">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-800">Шкала анализа</div>
            <div className="toggle-group">
              <button onClick={() => setParam('revenue')} className={'toggle-btn ' + (param === 'revenue' ? 'toggle-btn-active' : '')}>Выручка ₸</button>
              <button onClick={() => setParam('quantity')} className={'toggle-btn ' + (param === 'quantity' ? 'toggle-btn-active' : '')}>КГ</button>
            </div>
          </div>
          <div className="space-y-1">
            <div><b>X</b> (стабильно): запас можно держать тонко — спрос почти не пляшет, легко планировать поставку.</div>
            <div><b>Y</b> (с колебаниями): держим страховой запас под сезонность/всплески; контроль на каждой партии.</div>
            <div><b>Z</b> (нестабильно): не замораживать оборот — заказывать под факт, по предзаказу или маленькими партиями. SKU с продажей в одном месяце за период автоматически Z.</div>
            <div className="mt-2 text-gray-500">
              <b>CV</b> = stddev / mean по помесячным {param === 'revenue' ? 'выручкам' : 'массам в кг'} (пропущенные месяцы = 0).
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><div className="panel-title">Доля по классам</div></div>
          <div className="p-3">
            <PieBreakdown data={pieData} height={220} />
            <div className="mt-2 text-center text-xs text-gray-500">{param === 'revenue' ? 'Выручка, ₸' : 'Масса, кг'}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Поиск SKU…"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px] focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="all">Все категории</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <div className="text-xs text-gray-500">Показано {filtered.length} из {data.rows.length} SKU</div>
          {(classFilter !== 'all' || categoryFilter !== 'all' || search) && (
            <button
              onClick={() => { setClassFilter('all'); setCategoryFilter('all'); setSearch(''); }}
              className="text-xs text-brand-600 hover:underline ml-auto"
            >
              Сбросить все фильтры ×
            </button>
          )}
        </div>
      </div>

      {/* Таблица с помесячной разбивкой */}
      <div className="panel">
        <div className="max-h-[70vh] overflow-auto relative">
          <table className="report w-full" style={{ minWidth: 900 + months.length * 100 }}>
            <thead className="sticky top-0 z-20 bg-gray-50 shadow-sm">
              <tr>
                <th className="w-10 text-gray-500 text-right">#</th>
                <th className="w-14">Класс</th>
                <th className="text-left min-w-[260px]">Номенклатура</th>
                <th className="text-left text-xs text-gray-500">Категория</th>
                <th className="text-right">CV</th>
                <th className="text-right">Среднее/мес</th>
                <th className="text-right">Мес. с продаж.</th>
                {months.map((m) => (
                  <th key={m} className="text-right text-xs whitespace-nowrap">{m}</th>
                ))}
                <th className="text-right">Итого {param === 'revenue' ? '₸' : 'кг'}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7 + months.length + 1} className="text-center text-gray-500 py-8">Нет данных под текущие фильтры</td></tr>
              )}
              {filtered.slice(0, 1000).map((r: any, i: number) => {
                const total = param === 'revenue' ? r.totalRevenue : r.totalQuantity;
                return (
                  <tr key={r.nomenclatureId || i} className="hover:bg-gray-50">
                    <td className="text-gray-400 text-xs num">{i + 1}</td>
                    <td>
                      <span
                        className="inline-flex w-6 h-6 rounded text-xs font-bold items-center justify-center text-white"
                        style={{ background: CLASS_COLOR[r.xyzClass as 'X' | 'Y' | 'Z'] }}
                      >
                        {r.xyzClass}
                      </span>
                    </td>
                    <td className="text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-0.5 h-4 rounded-full"
                          style={{ background: CLASS_COLOR[r.xyzClass as 'X' | 'Y' | 'Z'] }}
                        />
                        <span>{r.name}</span>
                        {r.singleMonth && <span className="text-[10px] px-1 rounded bg-rose-50 text-rose-700 border border-rose-200" title="Продажа была только в 1 месяце за период">1 мес</span>}
                      </div>
                    </td>
                    <td className="text-[11px] text-gray-500">{r.category || '—'}</td>
                    <td className="num text-xs">{(r.cv * 100).toFixed(1)}%</td>
                    <td className="num text-xs text-gray-600">
                      {param === 'revenue' ? fmt(r.mean) : fmtKg(r.mean)}
                    </td>
                    <td className="num text-xs">{r.monthsWithSales}/{r.monthsInPeriod}</td>
                    {months.map((m) => {
                      const v = r.byMonth[m] || 0;
                      return (
                        <td key={m} className="num text-xs">
                          {v > 0 ? (param === 'revenue' ? fmt(v) : fmtKg(v)) : <span className="text-gray-300">—</span>}
                        </td>
                      );
                    })}
                    <td className="num font-semibold">
                      {param === 'revenue' ? fmt(total) : fmtKg(total)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length > 1000 && (
                <tr>
                  <td colSpan={7 + months.length + 1} className="text-center text-xs text-gray-500 py-2">
                    …показано первых 1000 из {filtered.length}. Уточните фильтр.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📊 Методика</div>
        <div className="space-y-1">
          <div><b>CV</b> (коэффициент вариации) = stddev / mean по помесячным значениям {param === 'revenue' ? 'выручки' : 'массы'} за выбранный период. Пропущенные месяцы считаются как 0 — иначе сезонный товар (продажи только зимой) ошибочно попадал бы в стабильный класс X.</div>
          <div><b>Граничные значения</b>: X &lt; 10%, Y 10–25%, Z ≥ 25%.</div>
          <div><b>«1 мес»</b>: SKU с продажами только в одном месяце за период принудительно отнесён к Z — это «новинка», «разовая отгрузка» или «случайная сделка», а не стабильный спрос.</div>
          <div><b>Источник</b>: <code>RealizaciaItem</code> (фактические отгрузки), агрегация в TZ Asia/Almaty.</div>
        </div>
      </div>
    </div>
  );
}

function KpiBlock({ label, value, suffix, sub }: any) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value text-gray-900">
        {value}{suffix && <span className="text-base font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

'use client';

// Reuses receivables UI; only labels are flipped (мы должны, поставщикам).
import { useMemo, useState } from 'react';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return String(Math.round(n));
};

interface BucketDef { key: string; label: string; color: string }

export default function PayablesClient({
  initialData, bucketDefs,
}: {
  initialData: any;
  bucketDefs: BucketDef[];
}) {
  const [search, setSearch] = useState('');
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'debt' | 'age' | 'name'>('debt');

  const totalDebt = initialData.totals.debt;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = initialData.rows.filter((row: any) => {
      if (q && !row.kontragentName.toLowerCase().includes(q)) return false;
      if (activeBucket && (row.buckets[activeBucket] || 0) <= 0) return false;
      return row.totalDebt > 0 || row.prepayment > 0;
    });
    if (sortBy === 'name') r = r.slice().sort((a: any, b: any) => a.kontragentName.localeCompare(b.kontragentName));
    else if (sortBy === 'age') r = r.slice().sort((a: any, b: any) => b.oldestDays - a.oldestDays);
    else r = r.slice().sort((a: any, b: any) => b.totalDebt - a.totalDebt);
    return r;
  }, [initialData.rows, search, activeBucket, sortBy]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBlock label="Мы должны" value={fmtCompact(totalDebt)} suffix="₸" color="red" big />
        <KpiBlock label="Поставщиков" value={String(initialData.totals.creditorCount)} color="amber" />
        <KpiBlock label="Просрочка 30+ дн" value={fmtCompact(initialData.totals.overdue30Plus)} suffix="₸" color="red"
                  sub={totalDebt > 0 ? ((initialData.totals.overdue30Plus / totalDebt) * 100).toFixed(1) + '% от долга' : ''} />
        <KpiBlock label="Авансы выданные" value={fmtCompact(initialData.totals.prepayments)} suffix="₸" color="green" />
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Старение долга поставщикам</div>
          {activeBucket && (
            <button onClick={() => setActiveBucket(null)} className="text-xs text-brand-600 hover:underline">
              Сбросить фильтр ×
            </button>
          )}
        </div>
        <div className="p-4 space-y-4">
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
            {bucketDefs.map((b) => {
              const v = initialData.totals.buckets[b.key] || 0;
              const pct = totalDebt > 0 ? (v / totalDebt) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div key={b.key}
                     style={{ width: `${pct}%`, background: b.color, opacity: activeBucket && activeBucket !== b.key ? 0.3 : 1 }}
                     title={`${b.label}: ${fmt(v)} ₸ (${pct.toFixed(1)}%)`} />
              );
            })}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {bucketDefs.map((b) => {
              const v = initialData.totals.buckets[b.key] || 0;
              const pct = totalDebt > 0 ? (v / totalDebt) * 100 : 0;
              const isActive = activeBucket === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => setActiveBucket(isActive ? null : b.key)}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    isActive ? 'border-gray-900 shadow-sm bg-white' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider"
                       style={{ color: b.color }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: b.color }} />
                    {b.label}
                  </div>
                  <div className="text-lg font-bold tabular-nums mt-1">{fmtCompact(v)} <span className="text-xs text-gray-500">₸</span></div>
                  <div className="text-[11px] text-gray-500">{pct.toFixed(1)}% долга</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="Поиск поставщика…"
                 className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px]" />
          <div className="text-xs text-gray-500">
            Показано {rows.length} из {initialData.rows.length}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-gray-500 uppercase tracking-wider">Сортировка:</span>
            <div className="toggle-group">
              <button onClick={() => setSortBy('debt')} className={'toggle-btn ' + (sortBy === 'debt' ? 'toggle-btn-active' : '')}>Долг</button>
              <button onClick={() => setSortBy('age')} className={'toggle-btn ' + (sortBy === 'age' ? 'toggle-btn-active' : '')}>Возраст</button>
              <button onClick={() => setSortBy('name')} className={'toggle-btn ' + (sortBy === 'name' ? 'toggle-btn-active' : '')}>Имя</button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Поставщик</th>
              <th className="text-right">Мы должны</th>
              {bucketDefs.map((b) => (
                <th key={b.key} className="text-right">
                  <span style={{ borderBottom: `2px solid ${b.color}` }}>{b.label}</span>
                </th>
              ))}
              <th className="text-right">Самый старый</th>
              <th className="text-right">Аванс выд.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-gray-500 py-8">Долгов поставщикам нет</td></tr>
            )}
            {rows.map((r: any, i: number) => (
              <tr key={r.kontragentId}>
                <td className="text-gray-400 text-xs">{i + 1}</td>
                <td className="text-sm">{r.kontragentName}</td>
                <td className="num font-semibold">{fmt(r.totalDebt)}</td>
                {bucketDefs.map((b) => {
                  const v = r.buckets[b.key] || 0;
                  return (
                    <td key={b.key} className="num text-xs" style={{ color: v > 0 ? b.color : '#9ca3af' }}>
                      {v > 0 ? fmt(v) : '—'}
                    </td>
                  );
                })}
                <td className="num text-xs">
                  {r.oldestDate ? (
                    <span className={r.oldestDays > 30 ? 'text-red-700 font-medium' : 'text-gray-600'}>
                      {r.oldestDays} дн
                    </span>
                  ) : '—'}
                </td>
                <td className="num text-xs text-green-700">{r.prepayment > 0 ? fmt(r.prepayment) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiBlock({ label, value, suffix, sub, color, big }: any) {
  const colorClasses: Record<string, string> = {
    red: 'from-red-50 to-red-100 border-red-200 text-red-900',
    amber: 'from-amber-50 to-amber-100 border-amber-200 text-amber-900',
    green: 'from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-900',
    blue: 'from-blue-50 to-blue-100 border-blue-200 text-blue-900',
  };
  const cls = colorClasses[color || 'blue'];
  return (
    <div className={`bg-gradient-to-br border rounded-xl p-4 ${cls}`}>
      <div className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</div>
      <div className={`font-bold tabular-nums ${big ? 'text-3xl' : 'text-2xl'} mt-1`}>
        {value}{suffix && <span className="text-base font-semibold opacity-60 ml-1">{suffix}</span>}
      </div>
      {sub && <div className="text-xs opacity-70 mt-1">{sub}</div>}
    </div>
  );
}

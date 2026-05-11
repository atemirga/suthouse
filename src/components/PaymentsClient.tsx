'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

const DOC_TYPE_LABELS: Record<string, string> = {
  PostuplenieVKassu: 'Поступл. в кассу',
  RashodIzKassy: 'Расход из кассы',
  PostuplenieNaSchet: 'Поступл. на счёт',
  RashodSoScheta: 'Расход со счёта',
  PeremeschenieDC: 'Перемещение',
};

export default function PaymentsClient({
  initial, kassas, banks,
}: {
  initial: any;
  kassas: { id: string; name: string }[];
  banks: { id: string; name: string }[];
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(sp.get('q') || '');

  useEffect(() => {
    setLoading(true);
    fetch('/api/payments?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function update(key: string, value: string | null) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  }

  function applySearch() { update('q', search || null); }

  const direction = sp.get('direction') || 'all';
  const kassaId = sp.get('kassaId') || '';
  const accountId = sp.get('accountId') || '';

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Поступления" value={fmt(data.totals.inflow) + ' ₸'} color="green" />
        <Kpi label="Списания" value={fmt(data.totals.outflow) + ' ₸'} color="red" />
        <Kpi label="Перемещения" value={fmt(data.totals.transfer) + ' ₸'} />
        <Kpi label="Записей" value={fmt(data.total)} sub={`показано ${data.rows.length}`} />
      </div>

      <div className="panel">
        <div className="px-4 py-3 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Направление</div>
            <div className="toggle-group">
              {[['all', 'Все'], ['inflow', 'Поступл'], ['outflow', 'Расход'], ['transfer', 'Перемещ']].map(([k, l]) => (
                <button key={k} onClick={() => update('direction', k === 'all' ? null : k)}
                        className={'toggle-btn ' + (direction === k ? 'toggle-btn-active' : '')}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Касса</div>
            <select value={kassaId} onChange={(e) => update('kassaId', e.target.value || null)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[200px]">
              <option value="">— все —</option>
              {kassas.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Банк. счёт</div>
            <select value={accountId} onChange={(e) => update('accountId', e.target.value || null)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[200px]">
              <option value="">— все —</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[240px]">
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Поиск</div>
            <div className="flex gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                     placeholder="Контрагент, статья, назначение, №..."
                     className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white flex-1" />
              <button onClick={applySearch} className="btn btn-primary">Найти</button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th>Дата</th>
              <th>№</th>
              <th>Тип</th>
              <th>Касса/Счёт</th>
              <th>Контрагент</th>
              <th>Статья ДДС</th>
              <th className="text-right">Сумма</th>
              <th className="text-right">Комиссия</th>
              <th>Назначение</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-gray-500 py-8">Нет данных</td></tr>
            )}
            {data.rows.map((r: any) => {
              const dirColor = r.direction === 'inflow' ? 'text-emerald-700'
                : r.direction === 'outflow' ? 'text-rose-700' : 'text-gray-700';
              return (
                <tr key={r.id}>
                  <td className="text-xs whitespace-nowrap">{format(new Date(r.date), 'dd.MM.yyyy')}</td>
                  <td className="text-xs">{r.number}</td>
                  <td className="text-xs">
                    <span className={'pill ' + (r.direction === 'inflow' ? 'pill-green' : r.direction === 'outflow' ? 'pill-red' : 'pill-gray')}>
                      {DOC_TYPE_LABELS[r.docType] || r.docType}
                    </span>
                  </td>
                  <td className="text-xs">
                    {r.kassaName || r.accountName || '—'}
                    {r.kassaToName && <span className="text-gray-400"> → {r.kassaToName}</span>}
                  </td>
                  <td className="text-xs">{r.kontragentName || '—'}</td>
                  <td className="text-xs text-gray-600">{r.articleName || '—'}</td>
                  <td className={'num font-semibold ' + dirColor}>{fmt(r.amount)}</td>
                  <td className="num text-xs text-gray-500">{r.commission > 0 ? fmt(r.commission) : '—'}</td>
                  <td className="text-xs text-gray-500 max-w-md truncate" title={r.paymentPurpose || r.comment || ''}>
                    {r.paymentPurpose || r.comment || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, color, sub }: any) {
  const cls = color === 'green' ? 'text-emerald-700' : color === 'red' ? 'text-rose-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

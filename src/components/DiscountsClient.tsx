'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import Modal from './Modal';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

type View = 'contractor' | 'item' | 'manager';

interface DrillRow {
  realizaciaId: string;
  date: string;
  number: string;
  kontragentName: string | null;
  responsibleName: string | null;
  discountSum: number;
  revenue: number;
  pct: number;
  itemsCount: number;
}

export default function DiscountsClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('contractor');
  const [search, setSearch] = useState('');
  const [drill, setDrill] = useState<{ title: string; subtitle: string; rows: DrillRow[] } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  async function openDrill(row: any) {
    const p = new URLSearchParams(sp.toString());
    let subtitle = '';
    if (view === 'contractor') {
      p.set('drill', 'contractor');
      p.set('id', row.kontragentId || 'no-id');
      subtitle = `Контрагент · ${fmt(row.discountSum)} ₸ скидки · ${row.pct.toFixed(2)}%`;
    } else if (view === 'item') {
      p.set('drill', 'item');
      if (row.nomenclatureId) p.set('id', row.nomenclatureId);
      else p.set('name', row.name);
      subtitle = `Позиция · ${fmt(row.discountSum)} ₸ скидки · ${row.pct.toFixed(2)}%`;
    } else {
      p.set('drill', 'manager');
      p.set('name', row.name);
      subtitle = `Менеджер · ${fmt(row.discountSum)} ₸ скидки · ${row.pct.toFixed(2)}%`;
    }
    setDrill({ title: row.name, subtitle, rows: [] });
    setDrillLoading(true);
    try {
      const r = await fetch('/api/discounts?' + p.toString());
      const d = await r.json();
      setDrill({ title: row.name, subtitle, rows: d.docs || [] });
    } finally {
      setDrillLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    fetch('/api/discounts?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  const rows = useMemo(() => {
    if (!data) return [];
    const src = view === 'contractor' ? data.byContractor : view === 'item' ? data.byItem : data.byManager;
    const q = search.trim().toLowerCase();
    if (!q) return src;
    return src.filter((r: any) => r.name.toLowerCase().includes(q));
  }, [data, view, search]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const t = data.totals;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Скидок выдано" value={fmt(t.discount) + ' ₸'} color="amber" />
        <Kpi label="% от валовой выручки" value={t.pct.toFixed(2) + '%'} color="amber" />
        <Kpi label="Документов" value={fmt(t.documentsCount)} sub={`${fmt(t.itemsCount)} позиций`} />
        <Kpi label="Чистая выручка" value={fmt(t.revenue) + ' ₸'} />
      </div>

      <div className="panel">
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="toggle-group">
            <button onClick={() => setView('contractor')} className={'toggle-btn ' + (view === 'contractor' ? 'toggle-btn-active' : '')}>По контрагентам</button>
            <button onClick={() => setView('item')} className={'toggle-btn ' + (view === 'item' ? 'toggle-btn-active' : '')}>По позициям</button>
            <button onClick={() => setView('manager')} className={'toggle-btn ' + (view === 'manager' ? 'toggle-btn-active' : '')}>По менеджерам</button>
          </div>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[240px]"
          />
          <div className="text-xs text-gray-500">Показано {rows.length}</div>
        </div>
      </div>

      <div className="text-xs text-gray-500 px-1">
        Строки с дисконтом <b>&gt;1.1%</b> подсвечены — обычно скидка выше 1.1% требует разрешения.
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>{view === 'contractor' ? 'Контрагент' : view === 'item' ? 'Позиция' : 'Менеджер'}</th>
              {view !== 'manager' && <th>Автор</th>}
              {view === 'contractor' && <th className="text-right">Документов</th>}
              <th className="text-right">Сумма скидки</th>
              <th className="text-right">Чистая выручка</th>
              <th className="text-right">% скидки</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-500 py-8">Нет данных</td></tr>
            )}
            {rows.slice(0, 500).map((r: any, i: number) => {
              const flagged = r.pct > 1.1;
              const rowCls = flagged
                ? 'bg-amber-50/60 hover:bg-amber-100/70'
                : 'hover:bg-gray-50';
              return (
                <tr key={i} className={rowCls}>
                  <td className="text-gray-400 text-xs">{i + 1}</td>
                  <td className="text-sm">
                    {flagged && <span title="Скидка выше 1.1%" className="text-amber-600 mr-1">⚠</span>}
                    <button
                      type="button"
                      onClick={() => openDrill(r)}
                      className="text-left hover:text-brand-700 hover:underline"
                      title="Показать заявки со скидкой"
                    >
                      {r.name}
                    </button>
                  </td>
                  {view !== 'manager' && (
                    <td className="text-xs text-gray-600">{r.topManager || <span className="text-gray-300">—</span>}</td>
                  )}
                  {view === 'contractor' && <td className="num text-xs text-gray-500">{fmt(r.documentsCount)}</td>}
                  <td className="num font-semibold text-amber-700">{fmt(r.discountSum)}</td>
                  <td className="num text-xs">{fmt(r.revenue)}</td>
                  <td className="num text-xs">
                    <span className={
                      r.pct > 10 ? 'text-rose-700 font-semibold' :
                      r.pct > 5 ? 'text-rose-600 font-medium' :
                      r.pct > 1.1 ? 'text-amber-700 font-medium' :
                      'text-gray-600'
                    }>
                      {r.pct.toFixed(2)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 500 && (
            <tfoot><tr><td colSpan={7} className="text-xs text-gray-500 text-center py-2">…показано первых 500</td></tr></tfoot>
          )}
        </table>
      </div>

      <Modal
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={drill?.title || ''}
        subtitle={drill?.subtitle}
        size="xl"
      >
        {drillLoading && <div className="text-sm text-gray-500 py-8 text-center">Загрузка…</div>}
        {!drillLoading && drill && drill.rows.length === 0 && (
          <div className="text-sm text-gray-500 py-8 text-center">Нет заявок со скидкой</div>
        )}
        {!drillLoading && drill && drill.rows.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 mb-2">
              Всего {drill.rows.length} {drill.rows.length === 1 ? 'заявка' : 'заявок'} ·
              сумма скидки {fmt(drill.rows.reduce((s, r) => s + r.discountSum, 0))} ₸
            </div>
            <div className="overflow-x-auto">
              <table className="report w-full">
                <thead>
                  <tr>
                    <th className="text-left">Дата</th>
                    <th className="text-left">№ документа</th>
                    <th className="text-left">Контрагент</th>
                    {view !== 'manager' && <th className="text-left">Менеджер</th>}
                    <th className="text-right">Позиций</th>
                    <th className="text-right">Скидка ₸</th>
                    <th className="text-right">Выручка ₸</th>
                    <th className="text-right">% скидки</th>
                  </tr>
                </thead>
                <tbody>
                  {drill.rows.map((d) => {
                    const flagged = d.pct > 1.1;
                    return (
                      <tr key={d.realizaciaId} className={flagged ? 'bg-amber-50/40' : 'hover:bg-gray-50'}>
                        <td className="text-xs whitespace-nowrap">{format(new Date(d.date), 'dd.MM.yyyy')}</td>
                        <td className="text-xs font-mono">{d.number}</td>
                        <td className="text-xs">{d.kontragentName || <span className="text-gray-400">—</span>}</td>
                        {view !== 'manager' && (
                          <td className="text-xs text-gray-600">{d.responsibleName || <span className="text-gray-300">—</span>}</td>
                        )}
                        <td className="num text-xs text-gray-500">{d.itemsCount}</td>
                        <td className="num font-semibold text-amber-700">{fmt(d.discountSum)}</td>
                        <td className="num text-xs">{fmt(d.revenue)}</td>
                        <td className="num text-xs">
                          <span className={
                            d.pct > 10 ? 'text-rose-700 font-semibold' :
                            d.pct > 5 ? 'text-rose-600 font-medium' :
                            d.pct > 1.1 ? 'text-amber-700 font-medium' :
                            'text-gray-600'
                          }>
                            {d.pct.toFixed(2)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ label, value, color, sub }: any) {
  const cls = color === 'amber' ? 'text-amber-700' : color === 'green' ? 'text-emerald-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

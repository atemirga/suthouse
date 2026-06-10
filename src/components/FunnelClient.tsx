'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Modal from './Modal';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtKg = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
};

const SOURCE_COLORS: Record<string, string> = {
  Instagram: '#ec4899', 'Tik-tok': '#0ea5e9', OLX: '#84cc16',
  'Сарафан': '#f59e0b', 'Ютуб': '#ef4444',
};
const colorFor = (name: string) => SOURCE_COLORS[name] || '#94a3b8';

type SortKey =
  | 'sourceName' | 'contractors' | 'withOrder' | 'withSale'
  | 'newClients' | 'newClientsKg' | 'newClientsRevenue'
  | 'convOrder' | 'convSale' | 'ordersAmount' | 'revenue'
  | 'kg' | 'avgCheck' | 'profit' | 'lossesAmount';

export default function FunnelClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<any | null>(null);
  const [details, setDetails] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    if (!selected) { setDetails(null); return; }
    setDetailsLoading(true);
    const params = new URLSearchParams(sp.toString());
    params.set('sourceId', selected.sourceId || 'unknown');
    fetch('/api/sales/funnel/details?' + params.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setDetails(d); })
      .finally(() => setDetailsLoading(false));
  }, [selected, sp]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/funnel?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'sourceName' ? 'asc' : 'desc'); }
  }

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const arr = [...data.rows];
    arr.sort((a, b) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb, 'ru') : vb.localeCompare(va, 'ru');
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
    return arr;
  }, [data, sortKey, sortDir]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const t = data.totals;

  const SortHeader = ({ label, k, align = 'right' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => {
    const active = k === sortKey;
    const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return (
      <th
        className={`cursor-pointer select-none hover:bg-gray-100 ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => setSort(k)}
      >
        <span className={active ? 'text-brand-700 font-semibold' : ''}>{label}{arrow}</span>
      </th>
    );
  };

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Контрагентов" value={fmt(t.contractors)} sub={`${data.rows.length} источников`} />
        <Kpi label="С заказом" value={fmt(t.withOrder)} sub={`${t.convOrder.toFixed(1)}% от контр.`} color="amber" />
        <Kpi label="Купили" value={fmt(t.withSale)} sub={`${t.convSale.toFixed(1)}% от заказов`} color="green" />
        <Kpi label="Новых клиентов" value={fmt(t.newClients)} sub={`${fmtCompact(t.newClientsKg)} кг · ${fmtCompact(t.newClientsRevenue)} ₸`} color="blue" />
        <Kpi label="Выручка / Отгружено" value={fmtCompact(t.revenue)} suffix="₸" sub={`${fmtCompact(t.kg)} кг · ср. чек ${fmtCompact(t.avgCheck)}`} bold />
      </div>

      {/* Funnel visual */}
      <div className="panel">
        <div className="panel-header"><div className="panel-title">Этапы воронки</div></div>
        <div className="p-6 space-y-3">
          <FunnelStage label="Контрагенты с источником" value={t.contractors} max={t.contractors} color="#3b82f6" />
          <FunnelStage label="С заказом" value={t.withOrder} max={t.contractors} color="#f59e0b" pct={t.convOrder} />
          <FunnelStage label="Купили (отгрузка)" value={t.withSale} max={t.contractors} color="#10b981" pct={t.convSale} fromAbove />
          {t.losses > 0 && (
            <div className="ml-3 text-xs text-rose-700 italic flex items-center gap-2">
              <span>⚠ Потери (заказали, но не купили):</span>
              <b>{fmt(t.losses)}</b> контр. · {fmtCompact(t.lossesAmount)} ₸
            </div>
          )}
          {t.newClients > 0 && (
            <div className="ml-3 text-xs text-blue-700 italic flex items-center gap-2">
              <span>🆕 Новых клиентов в этом периоде:</span>
              <b>{fmt(t.newClients)}</b> · {fmtCompact(t.newClientsKg)} кг · {fmtCompact(t.newClientsRevenue)} ₸
            </div>
          )}
        </div>
      </div>

      {/* By source — карточки */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sortedRows.map((r: any, i: number) => {
          const c = colorFor(r.sourceName);
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(r)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r); } }}
              className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-brand-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                  <div className="font-semibold">{r.sourceName}</div>
                </div>
                <div className="text-xs text-gray-500">{r.contractors} контр.</div>
              </div>
              <div className="flex items-baseline gap-3 mb-3">
                <div>
                  <div className="text-2xl font-bold tabular-nums">{fmtCompact(r.revenue)} <span className="text-sm text-gray-500">₸</span></div>
                  <div className="text-[10px] text-gray-500">выручка</div>
                </div>
                <div className="ml-auto">
                  <div className="text-lg font-bold tabular-nums text-blue-700">{fmtCompact(r.kg)}</div>
                  <div className="text-[10px] text-gray-500">кг</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-gray-500">С заказом</div><div className="font-semibold">{r.withOrder} <span className="text-gray-400">({r.convOrder.toFixed(0)}%)</span></div></div>
                <div><div className="text-gray-500">Купили</div><div className="font-semibold">{r.withSale} <span className="text-gray-400">({r.convSale.toFixed(0)}%)</span></div></div>
                <div><div className="text-gray-500">Ср. чек</div><div className="font-semibold">{fmtCompact(r.avgCheck)} ₸</div></div>
                <div><div className="text-gray-500">Прибыль</div><div className={'font-semibold ' + (r.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmtCompact(r.profit)} ₸</div></div>
              </div>
              {r.newClients > 0 && (
                <div className="mt-2 text-[11px] text-blue-700 bg-blue-50 rounded px-2 py-1">
                  🆕 <b>{r.newClients}</b> новых клиентов · {fmtKg(r.newClientsKg)} кг · {fmtCompact(r.newClientsRevenue)} ₸
                </div>
              )}
              {r.losses > 0 && (
                <div className="mt-1 text-[11px] text-rose-700 bg-rose-50 rounded px-2 py-1">
                  ⚠ Потеря {r.losses} клиентов · {fmtCompact(r.lossesAmount)} ₸
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="panel">
        <div className="overflow-auto max-h-[70vh]">
          <table className="report w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
              <tr>
                <SortHeader label="Источник" k="sourceName" align="left" />
                <SortHeader label="Контр." k="contractors" />
                <SortHeader label="С заказом" k="withOrder" />
                <SortHeader label="Купили" k="withSale" />
                <SortHeader label="Конв.заказ" k="convOrder" />
                <SortHeader label="Конв.продажа" k="convSale" />
                <SortHeader label="🆕 Новых" k="newClients" />
                <SortHeader label="🆕 КГ" k="newClientsKg" />
                <SortHeader label="🆕 Выручка" k="newClientsRevenue" />
                <SortHeader label="КГ всего" k="kg" />
                <SortHeader label="Выручка" k="revenue" />
                <SortHeader label="Ср. чек" k="avgCheck" />
                <SortHeader label="Прибыль" k="profit" />
                <SortHeader label="Потери ₸" k="lossesAmount" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
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
                  <td className="num text-blue-700 font-medium">{r.newClients > 0 ? fmt(r.newClients) : <span className="text-gray-300">—</span>}</td>
                  <td className="num text-xs text-blue-700">{r.newClientsKg > 0 ? fmtKg(r.newClientsKg) : <span className="text-gray-300">—</span>}</td>
                  <td className="num text-xs text-blue-700">{r.newClientsRevenue > 0 ? fmt(r.newClientsRevenue) : <span className="text-gray-300">—</span>}</td>
                  <td className="num text-xs">{fmtKg(r.kg)}</td>
                  <td className="num font-semibold">{fmt(r.revenue)}</td>
                  <td className="num text-xs">{fmt(r.avgCheck)}</td>
                  <td className={'num ' + (r.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(r.profit)}</td>
                  <td className="num text-xs text-rose-700">{r.lossesAmount > 0 ? fmt(r.lossesAmount) : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-brand-50 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
              <tr className="total border-t-2 border-brand-200">
                <td className="font-semibold text-brand-700 uppercase text-xs tracking-wider">Итого</td>
                <td className="num">{fmt(t.contractors)}</td>
                <td className="num">{fmt(t.withOrder)}</td>
                <td className="num">{fmt(t.withSale)}</td>
                <td className="num">{t.convOrder.toFixed(1)}%</td>
                <td className="num">{t.convSale.toFixed(1)}%</td>
                <td className="num text-blue-700">{fmt(t.newClients)}</td>
                <td className="num text-xs text-blue-700">{fmtKg(t.newClientsKg)}</td>
                <td className="num text-xs text-blue-700">{fmt(t.newClientsRevenue)}</td>
                <td className="num text-xs">{fmtKg(t.kg)}</td>
                <td className="num">{fmt(t.revenue)}</td>
                <td className="num">{fmt(t.avgCheck)}</td>
                <td className="num">{fmt(t.profit)}</td>
                <td className="num">{fmt(t.lossesAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 Методика</div>
        <div className="space-y-1">
          <div><b>Источник</b>: <code>AttractionSource</code> ← <code>Kontragent.attractionSourceId</code>.</div>
          <div><b>Контрагенты</b>: все клиенты с указанным источником (привязка задаётся в 1С).</div>
          <div><b>С заказом</b>: контрагент, у которого есть хотя бы один <code>OrderBuyer</code> за период.</div>
          <div><b>Купили</b>: есть хотя бы одна <code>Realizacia</code> (Расходная накладная) за период.</div>
          <div><b>🆕 Новые клиенты</b>: те, чья ПЕРВАЯ Realizacia в истории попала в текущий период.</div>
          <div><b>КГ</b>: <code>RealizaciaItem.quantity</code> отгружённого товара (все товары весовые).</div>
          <div><b>Потери</b>: контрагент с заказом, но без продажи — заказ не дошёл до отгрузки в этот период.</div>
        </div>
      </div>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: colorFor(selected.sourceName) }} />
            {selected.sourceName}
          </span>
        ) : ''}
        subtitle={selected && (
          <span>
            {fmt(selected.contractors)} контрагентов · с заказом <b>{fmt(selected.withOrder)}</b> ({selected.convOrder.toFixed(0)}%) · купили <b>{fmt(selected.withSale)}</b> ({selected.convSale.toFixed(0)}%) ·
            {' '}<b className="text-gray-700">{fmtCompact(selected.revenue)} ₸</b> ·
            {' '}<b className="text-blue-700">{fmtCompact(selected.kg)} кг</b>
          </span>
        )}
      >
        {detailsLoading && <div className="text-sm text-gray-500">Загружаю детали…</div>}
        {!detailsLoading && details && (
          <FunnelDetails data={details} />
        )}
      </Modal>
    </div>
  );
}

function FunnelDetails({ data }: { data: any }) {
  const [tab, setTab] = useState<'bought' | 'lost' | 'new' | 'ordered'>('bought');
  const tabs: { k: typeof tab; label: string; count: number; cls: string }[] = [
    { k: 'bought', label: 'Купили', count: data.bought.length, cls: 'text-emerald-700 border-emerald-500' },
    { k: 'lost', label: '⚠ Потеряны', count: data.lost.length, cls: 'text-rose-700 border-rose-500' },
    { k: 'new', label: '🆕 Новые', count: data.new.length, cls: 'text-blue-700 border-blue-500' },
    { k: 'ordered', label: 'С заказом', count: data.ordered.length, cls: 'text-amber-700 border-amber-500' },
  ];
  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-4 -mt-2">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={
              'px-3 py-2 text-sm font-medium border-b-2 transition-colors ' +
              (tab === t.k ? t.cls : 'border-transparent text-gray-500 hover:text-gray-800')
            }
          >
            {t.label} <span className="text-xs text-gray-400">({t.count})</span>
          </button>
        ))}
      </div>

      {tab === 'bought' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Клиент</th>
              <th className="text-right">Отгрузок</th>
              <th className="text-right">КГ</th>
              <th className="text-right">Выручка ₸</th>
              <th className="text-right">Прибыль ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.bought.map((c: any) => (
              <tr key={c.kontragentId} className="hover:bg-gray-50">
                <td className="font-medium">{c.kontragentName}</td>
                <td className="num">{fmt(c.salesCount)}</td>
                <td className="num text-blue-700">{fmtKg(c.kg)}</td>
                <td className="num font-semibold">{fmt(c.salesAmount)}</td>
                <td className={'num ' + (c.profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(c.profit)}</td>
              </tr>
            ))}
            {data.bought.length === 0 && <tr><td colSpan={5} className="text-center text-gray-400 py-4">Никто не купил из этого источника</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'lost' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Клиент</th>
              <th className="text-right">Заказов</th>
              <th className="text-right">Сумма заказов ₸</th>
              <th className="text-right">Оплачено ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.lost.map((c: any) => (
              <tr key={c.kontragentId} className="hover:bg-gray-50">
                <td className="font-medium">{c.kontragentName}</td>
                <td className="num">{fmt(c.ordersCount)}</td>
                <td className="num text-rose-700 font-semibold">{fmt(c.ordersAmount)}</td>
                <td className="num">{fmt(c.paidAmount)}</td>
              </tr>
            ))}
            {data.lost.length === 0 && <tr><td colSpan={4} className="text-center text-gray-400 py-4">Все заказы дошли до отгрузки</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'new' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Клиент</th>
              <th className="text-left">Первая покупка</th>
              <th className="text-right">КГ</th>
              <th className="text-right">Выручка ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.new.map((c: any) => (
              <tr key={c.kontragentId} className="hover:bg-gray-50">
                <td className="font-medium">{c.kontragentName}</td>
                <td className="text-xs">{new Date(c.firstSaleDate).toLocaleDateString('ru-RU')}</td>
                <td className="num text-blue-700">{fmtKg(c.kg)}</td>
                <td className="num font-semibold">{fmt(c.salesAmount)}</td>
              </tr>
            ))}
            {data.new.length === 0 && <tr><td colSpan={4} className="text-center text-gray-400 py-4">Новых клиентов нет</td></tr>}
          </tbody>
        </table>
      )}

      {tab === 'ordered' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Клиент</th>
              <th className="text-right">Заказов</th>
              <th className="text-right">Сумма заказов ₸</th>
              <th className="text-right">Отгружено ₸</th>
              <th className="text-right">КГ</th>
            </tr>
          </thead>
          <tbody>
            {data.ordered.map((c: any) => (
              <tr key={c.kontragentId} className="hover:bg-gray-50">
                <td className="font-medium">{c.kontragentName}</td>
                <td className="num">{fmt(c.ordersCount)}</td>
                <td className="num">{fmt(c.ordersAmount)}</td>
                <td className="num">{fmt(c.salesAmount)}</td>
                <td className="num text-blue-700">{fmtKg(c.kg)}</td>
              </tr>
            ))}
            {data.ordered.length === 0 && <tr><td colSpan={5} className="text-center text-gray-400 py-4">Заказов нет</td></tr>}
          </tbody>
        </table>
      )}
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

function Kpi({ label, value, suffix, color, sub, bold }: any) {
  const cls = color === 'green' ? 'text-emerald-700' : color === 'amber' ? 'text-amber-700' : color === 'red' ? 'text-rose-700' : color === 'blue' ? 'text-blue-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls + (bold ? ' font-extrabold' : '')}>
        {value}{suffix && <span className="text-base font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

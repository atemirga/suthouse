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

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#a855f7'];

type SortKey =
  | 'name' | 'salesKg' | 'salesAmount' | 'salesProfit' | 'salesMargin'
  | 'planAmountPct' | 'planKgPct' | 'avgCheck' | 'ordersCount' | 'newClients';

export default function ManagersClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('salesAmount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<any | null>(null);
  const [details, setDetails] = useState<any | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    if (!selected) { setDetails(null); return; }
    setDetailsLoading(true);
    const params = new URLSearchParams(sp.toString());
    params.set('name', selected.name);
    fetch('/api/sales/by-manager/details?' + params.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setDetails(d); })
      .finally(() => setDetailsLoading(false));
  }, [selected, sp]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/sales/by-manager?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc'); }
  }

  const sortedRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb, 'ru') : vb.localeCompare(va, 'ru');
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [data, sortKey, sortDir]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const t = data.totals;
  const maxRev = data.rows[0]?.salesAmount || 1;
  const totalPlanPct = t.planAmount > 0 ? (t.salesAmount / t.planAmount) * 100 : 0;

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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Менеджеров" value={data.rows.length.toLocaleString('ru-RU')} sub={`${fmt(t.salesCount)} отгрузок`} />
        <Kpi label="Отгружено" value={fmtCompact(t.salesKg)} suffix="кг" sub={fmtCompact(t.salesAmount) + ' ₸'} />
        <Kpi label="Заказы" value={fmt(t.ordersCount)} sub={fmtCompact(t.ordersAmount) + ' ₸'} />
        <Kpi
          label="План — общий"
          value={t.planAmount > 0 ? `${totalPlanPct.toFixed(0)}%` : '—'}
          sub={t.planAmount > 0 ? `${fmtCompact(t.salesAmount)} / ${fmtCompact(t.planAmount)} ₸` : 'плана нет'}
          color={totalPlanPct >= 100 ? 'green' : totalPlanPct >= 80 ? 'amber' : 'red'}
        />
        <Kpi label="Новых клиентов" value={fmt(t.newClients)} color="blue" sub={t.newClients > 0 ? 'первые покупки за период' : ''} />
      </div>

      {/* Cards by manager */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sortedRows.map((m: any, i: number) => {
          const c = COLORS[i % COLORS.length];
          const pct = (m.salesAmount / maxRev) * 100;
          const planPct = m.planAmountPct;
          const planClr = planPct >= 100 ? '#10b981' : planPct >= 80 ? '#f59e0b' : '#ef4444';
          const planKgClr = m.planKgPct >= 100 ? '#10b981' : m.planKgPct >= 80 ? '#f59e0b' : '#ef4444';
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(m)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(m); } }}
              className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-brand-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ background: c }}>
                  {m.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{m.name}</div>
                  <div className="text-xs text-gray-500">
                    {m.ordersCount} заказов · {m.salesCount} отгрузок
                  </div>
                </div>
                {m.newClients > 0 && (
                  <span className="bg-blue-50 text-blue-700 text-xs font-semibold rounded px-1.5 py-0.5">
                    🆕 {m.newClients}
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-3 mb-1">
                <div>
                  <div className="text-2xl font-bold tabular-nums">
                    {fmtCompact(m.salesAmount)} <span className="text-sm text-gray-500">₸</span>
                  </div>
                  <div className="text-[10px] text-gray-500">выручка</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-2xl font-bold tabular-nums text-blue-700">
                    {fmtCompact(m.salesKg)} <span className="text-sm text-gray-500">кг</span>
                  </div>
                  <div className="text-[10px] text-gray-500">отгружено</div>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-3">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
              </div>

              {/* План progress bars (только если задан) */}
              {(m.planAmount > 0 || m.planKg > 0) && (
                <div className="bg-gray-50 rounded-md p-2.5 mb-3 space-y-2">
                  {m.planAmount > 0 && (
                    <div>
                      <div className="flex items-baseline justify-between text-xs mb-0.5">
                        <span className="text-gray-600">План выручки</span>
                        <span className="font-semibold tabular-nums">
                          <span style={{ color: planClr }}>{planPct.toFixed(0)}%</span>
                          <span className="text-gray-400 ml-1">{fmtCompact(m.salesAmount)} / {fmtCompact(m.planAmount)}</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, planPct)}%`, background: planClr }}
                        />
                        {/* Маркер сверх плана */}
                        {planPct > 100 && (
                          <div className="text-[9px] text-emerald-600 -mt-3 text-right pr-1">+{(planPct - 100).toFixed(0)}%</div>
                        )}
                      </div>
                    </div>
                  )}
                  {m.planKg > 0 && (
                    <div>
                      <div className="flex items-baseline justify-between text-xs mb-0.5">
                        <span className="text-gray-600">План по кг</span>
                        <span className="font-semibold tabular-nums">
                          <span style={{ color: planKgClr }}>{m.planKgPct.toFixed(0)}%</span>
                          <span className="text-gray-400 ml-1">{fmtKg(m.salesKg)} / {fmtKg(m.planKg)} кг</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, m.planKgPct)}%`, background: planKgClr }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><div className="text-gray-500">Ср. чек</div><div className="font-semibold">{fmtCompact(m.avgCheck)} ₸</div></div>
                <div><div className="text-gray-500">Маржа</div><div className={'font-semibold ' + (m.salesMargin > 0 ? 'text-emerald-700' : 'text-rose-700')}>{(m.salesMargin * 100).toFixed(1)}%</div></div>
                <div><div className="text-gray-500">Заказы ₸</div><div className="font-semibold">{fmtCompact(m.ordersAmount)}</div></div>
                <div><div className="text-gray-500">Оплачено</div><div className="font-semibold">{(m.conversion * 100).toFixed(0)}%</div></div>
              </div>
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
                <SortHeader label="Менеджер" k="name" align="left" />
                <SortHeader label="Заказы" k="ordersCount" />
                <SortHeader label="🆕 Новых" k="newClients" />
                <SortHeader label="КГ" k="salesKg" />
                <SortHeader label="Выручка" k="salesAmount" />
                <SortHeader label="План ₸ %" k="planAmountPct" />
                <SortHeader label="План кг %" k="planKgPct" />
                <SortHeader label="Прибыль" k="salesProfit" />
                <SortHeader label="Маржа" k="salesMargin" />
                <SortHeader label="Ср. чек" k="avgCheck" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((m: any, i: number) => {
                const planClr = m.planAmountPct >= 100 ? 'text-emerald-700' : m.planAmountPct >= 80 ? 'text-amber-700' : 'text-rose-700';
                const planKgClr = m.planKgPct >= 100 ? 'text-emerald-700' : m.planKgPct >= 80 ? 'text-amber-700' : 'text-rose-700';
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="font-medium">{m.name}</td>
                    <td className="num text-xs">{fmt(m.ordersCount)} · {fmtCompact(m.ordersAmount)} ₸</td>
                    <td className="num text-blue-700">{m.newClients > 0 ? fmt(m.newClients) : <span className="text-gray-300">—</span>}</td>
                    <td className="num">{fmtKg(m.salesKg)}</td>
                    <td className="num font-semibold">{fmt(m.salesAmount)}</td>
                    <td className={'num text-xs ' + planClr}>
                      {m.planAmount > 0 ? `${m.planAmountPct.toFixed(0)}%` : <span className="text-gray-300">—</span>}
                      {m.planAmount > 0 && <div className="text-[10px] text-gray-400 font-normal">{fmtCompact(m.planAmount)} ₸</div>}
                    </td>
                    <td className={'num text-xs ' + planKgClr}>
                      {m.planKg > 0 ? `${m.planKgPct.toFixed(0)}%` : <span className="text-gray-300">—</span>}
                      {m.planKg > 0 && <div className="text-[10px] text-gray-400 font-normal">{fmtKg(m.planKg)} кг</div>}
                    </td>
                    <td className={'num ' + (m.salesProfit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(m.salesProfit)}</td>
                    <td className="num text-xs">{(m.salesMargin * 100).toFixed(1)}%</td>
                    <td className="num text-xs">{fmt(m.avgCheck)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-brand-50 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
              <tr className="total border-t-2 border-brand-200">
                <td className="font-semibold text-brand-700 uppercase text-xs tracking-wider">Итого</td>
                <td className="num">{fmt(t.ordersCount)}</td>
                <td className="num text-blue-700">{fmt(t.newClients)}</td>
                <td className="num">{fmtKg(t.salesKg)}</td>
                <td className="num">{fmt(t.salesAmount)}</td>
                <td className="num text-xs">{t.planAmount > 0 ? `${totalPlanPct.toFixed(0)}%` : '—'}</td>
                <td className="num text-xs">{t.planKg > 0 ? `${((t.salesKg / t.planKg) * 100).toFixed(0)}%` : '—'}</td>
                <td className="num">{fmt(t.salesProfit)}</td>
                <td className="num">{t.salesAmount > 0 ? ((t.salesProfit / t.salesAmount) * 100).toFixed(1) + '%' : '0%'}</td>
                <td className="num">{t.salesCount > 0 ? fmt(t.salesAmount / t.salesCount) : '0'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 Источники</div>
        <div className="space-y-1">
          <div><b>Заказы</b>: <code>OrderBuyer</code> (1С Заказ покупателя) — что менеджер заказал у клиентов.</div>
          <div><b>Отгрузки</b>: <code>Realizacia</code> (1С Расходная накладная) — реально отгруженный товар.</div>
          <div><b>КГ</b>: <code>RealizaciaItem.quantity</code> по фактическим отгрузкам.</div>
          <div><b>Себестоимость / Прибыль</b>: <code>Realizacia.factCost</code> (источник 1С), fallback на FIFO. Сходимо с ОПиУ.</div>
          <div><b>План</b>: <code>SalesPlan</code> со scope='manager'. Чтобы задать план менеджеру, перейдите на <a href="/sales/plans" className="text-brand-600 hover:underline">страницу планов</a>.</div>
          <div><b>🆕 Новых клиентов</b>: контрагенты, чья первая Realizacia за всю историю выпала на менеджера в этом периоде.</div>
        </div>
      </div>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || ''}
        subtitle={selected && (
          <span>
            {fmt(selected.ordersCount)} заказов · {fmt(selected.salesCount)} отгрузок ·
            {' '}<b className="text-gray-700">{fmtCompact(selected.salesAmount)} ₸</b> ·
            {' '}<b className="text-blue-700">{fmtCompact(selected.salesKg)} кг</b> ·
            {' '}маржа <b className={selected.salesMargin > 0 ? 'text-emerald-700' : 'text-rose-700'}>{(selected.salesMargin * 100).toFixed(1)}%</b>
          </span>
        )}
      >
        {detailsLoading && <div className="text-sm text-gray-500">Загружаю детали…</div>}
        {!detailsLoading && details && (
          <ManagerDetails data={details} />
        )}
      </Modal>
    </div>
  );
}

function ManagerDetails({ data }: { data: any }) {
  const [tab, setTab] = useState<'clients' | 'skus' | 'orders' | 'sales'>('clients');
  const tabs: { k: typeof tab; label: string; count: number }[] = [
    { k: 'clients', label: 'Клиенты', count: data.topClients.length },
    { k: 'skus', label: 'Товары', count: data.topSkus.length },
    { k: 'orders', label: 'Заказы', count: data.recentOrders.length },
    { k: 'sales', label: 'Отгрузки', count: data.recentSales.length },
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
              (tab === t.k
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-800')
            }
          >
            {t.label} <span className="text-xs text-gray-400">({t.count})</span>
          </button>
        ))}
      </div>

      {tab === 'clients' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Клиент</th>
              <th className="text-right">Отгрузок</th>
              <th className="text-right">КГ</th>
              <th className="text-right">Выручка ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.topClients.map((c: any) => (
              <tr key={c.kontragentId || c.kontragentName} className="hover:bg-gray-50">
                <td className="font-medium">{c.kontragentName}</td>
                <td className="num">{fmt(c.salesCount)}</td>
                <td className="num text-blue-700">{fmtKg(c.kg)}</td>
                <td className="num font-semibold">{fmt(c.amount)}</td>
              </tr>
            ))}
            {data.topClients.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-4">Нет данных за период</td></tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'skus' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Товар</th>
              <th className="text-right">КГ</th>
              <th className="text-right">Выручка ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.topSkus.map((s: any) => (
              <tr key={s.nomenclatureId || s.nomenclatureName} className="hover:bg-gray-50">
                <td className="font-medium">{s.nomenclatureName}</td>
                <td className="num text-blue-700">{fmtKg(s.kg)}</td>
                <td className="num font-semibold">{fmt(s.amount)}</td>
              </tr>
            ))}
            {data.topSkus.length === 0 && (
              <tr><td colSpan={3} className="text-center text-gray-400 py-4">Нет данных за период</td></tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'orders' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Дата</th>
              <th className="text-left">Номер</th>
              <th className="text-left">Клиент</th>
              <th className="text-right">Сумма ₸</th>
              <th className="text-right">Оплачено ₸</th>
              <th className="text-left">Статус</th>
            </tr>
          </thead>
          <tbody>
            {data.recentOrders.map((o: any) => (
              <tr key={o.id} className="hover:bg-gray-50">
                <td className="text-xs">{new Date(o.date).toLocaleDateString('ru-RU')}</td>
                <td className="text-xs font-mono">{o.number}</td>
                <td>{o.kontragentName}</td>
                <td className="num">{fmt(o.totalAmount)}</td>
                <td className="num text-emerald-700">{fmt(o.paidAmount)}</td>
                <td className="text-xs text-gray-500">{o.status || '—'}</td>
              </tr>
            ))}
            {data.recentOrders.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-4">Нет заказов за период</td></tr>
            )}
          </tbody>
        </table>
      )}

      {tab === 'sales' && (
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Дата</th>
              <th className="text-left">Номер</th>
              <th className="text-left">Клиент</th>
              <th className="text-right">КГ</th>
              <th className="text-right">Выручка ₸</th>
              <th className="text-right">Прибыль ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.recentSales.map((s: any) => {
              const profit = s.itemsAmount - (s.cost || 0);
              return (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="text-xs">{new Date(s.date).toLocaleDateString('ru-RU')}</td>
                  <td className="text-xs font-mono">{s.number}</td>
                  <td>{s.kontragentName}</td>
                  <td className="num text-blue-700">{fmtKg(s.kg)}</td>
                  <td className="num font-semibold">{fmt(s.itemsAmount)}</td>
                  <td className={'num ' + (profit > 0 ? 'text-emerald-700' : 'text-rose-700')}>{fmt(profit)}</td>
                </tr>
              );
            })}
            {data.recentSales.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-4">Нет отгрузок за период</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Kpi({ label, value, suffix, sub, color }: any) {
  const cls =
    color === 'green' ? 'text-emerald-700' :
    color === 'amber' ? 'text-amber-700' :
    color === 'red' ? 'text-rose-700' :
    color === 'blue' ? 'text-blue-700' :
    'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>
        {value}{suffix && <span className="text-base font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

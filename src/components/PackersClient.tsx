'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
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

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#a855f7', '#14b8a6', '#ef4444', '#22c55e', '#eab308', '#0ea5e9', '#a3a3a3', '#6b7280'];

type SortKey =
  | 'name' | 'ordersCount' | 'workingCount' | 'problemCount'
  | 'shippedKg' | 'ordersAmount' | 'avgOrder';

interface PackerDayRow {
  date: string;
  ordersCount: number;
  workingCount: number;
  problemCount: number;
  shippedKg: number;
}

interface PackerRow {
  name: string;
  ordersCount: number;
  ordersAmount: number;
  shippedKg: number;
  workingCount: number;
  workingAmount: number;
  problemCount: number;
  problemAmount: number;
  avgOrder: number;
  share: number;
  byDay: PackerDayRow[];
}

interface PendingOrder {
  id: string;
  number: string;
  date: string;
  shipmentDate: string | null;
  kontragentName: string | null;
  totalAmount: number;
  stateName: string | null;
}

interface PendingResponse {
  packer: string;
  bucket: 'working' | 'problem' | 'all';
  count: number;
  totalAmount: number;
  orders: PendingOrder[];
}

type StatusBucket = 'working' | 'otk' | 'otk_manager' | 'waiting' | 'problem' | 'completed' | 'unknown';
type StatusCounts = Record<StatusBucket, { count: number; amount: number }>;

// Маппинг + порядок отображения KPI. «unknown» скрываем, если 0.
const STATUS_DISPLAY: { key: StatusBucket; label: string; color: 'amber' | 'blue' | 'purple' | 'gray' | 'red' | 'green' }[] = [
  { key: 'working', label: 'В работе', color: 'amber' },
  { key: 'otk', label: 'ОТК', color: 'blue' },
  { key: 'otk_manager', label: 'Менеджер', color: 'purple' },
  { key: 'waiting', label: 'Ожидания', color: 'gray' },
  { key: 'problem', label: 'Проблема', color: 'red' },
  { key: 'completed', label: 'Завершен', color: 'green' },
];

interface Data {
  from: string;
  to: string;
  totals: {
    ordersCount: number; ordersAmount: number; shippedKg: number;
    workingCount: number; workingAmount: number;
    problemCount: number; problemAmount: number;
    byStatus: StatusCounts;
  };
  rows: (PackerRow & { byStatus: StatusCounts })[];
}

export default function PackersClient({ initial }: { initial: Data }) {
  const sp = useSearchParams();
  const [data, setData] = useState<Data | null>(initial);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('ordersCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [pendingData, setPendingData] = useState<PendingResponse | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);

  function toggleExpand(name: string) {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name); else next.add(name);
    setExpanded(next);
  }

  function openPending(name: string) {
    setPendingFor(name);
    setPendingData(null);
    setPendingLoading(true);
    const qs = new URLSearchParams(sp.toString());
    qs.set('packer', name);
    fetch('/api/packers/pending?' + qs.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setPendingData(d); })
      .finally(() => setPendingLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    fetch('/api/packers?' + sp.toString())
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
    return [...data.rows].sort((a: any, b: any) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb, 'ru') : vb.localeCompare(va, 'ru');
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [data, sortKey, sortDir]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка…</div>;

  const t = data.totals;
  const maxCount = Math.max(
    sortedRows[0]?.ordersCount || 0,
    ...sortedRows.map((r) => r.workingCount + r.problemCount),
    1,
  );

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

  const bs = t.byStatus;

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      {/* Воронка по статусам OrderBuyer из 1С (все заказы за период) */}
      <div className="panel p-4">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-3 font-semibold">
          Статусы заказов покупателей за период
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {STATUS_DISPLAY.map((s) => {
            const v = bs[s.key];
            const isZero = v.count === 0;
            const colorCls =
              s.color === 'amber' ? 'border-amber-300 bg-amber-50 text-amber-800' :
              s.color === 'blue' ? 'border-blue-300 bg-blue-50 text-blue-800' :
              s.color === 'purple' ? 'border-purple-300 bg-purple-50 text-purple-800' :
              s.color === 'red' ? 'border-rose-300 bg-rose-50 text-rose-800' :
              s.color === 'green' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' :
              'border-gray-300 bg-gray-50 text-gray-700';
            return (
              <div key={s.key} className={`rounded-lg border-2 p-3 ${isZero ? 'border-gray-200 bg-gray-50/50 text-gray-400' : colorCls}`}>
                <div className="text-[10px] uppercase tracking-wider opacity-70">{s.label}</div>
                <div className="text-2xl font-bold tabular-nums leading-tight">{fmt(v.count)}</div>
                <div className="text-[11px] opacity-70 tabular-nums">{fmtCompact(v.amount)} ₸</div>
              </div>
            );
          })}
          {bs.unknown.count > 0 && (
            <div className="rounded-lg border-2 border-gray-300 bg-gray-50 text-gray-700 p-3">
              <div className="text-[10px] uppercase tracking-wider opacity-70">Без статуса</div>
              <div className="text-2xl font-bold tabular-nums leading-tight">{fmt(bs.unknown.count)}</div>
              <div className="text-[11px] opacity-70 tabular-nums">{fmtCompact(bs.unknown.amount)} ₸</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Отгружено (расходных)" value={fmt(t.ordersCount)} sub={`${data.rows.length} упаковщиков · ${fmtCompact(t.ordersAmount)} ₸`} color="green" />
        <Kpi label="КГ отгружено" value={fmtKg(t.shippedKg)} suffix="кг" color="blue" />
        <Kpi
          label="В работе"
          value={fmt(t.workingCount)}
          sub={t.workingCount > 0 ? `${fmtCompact(t.workingAmount)} ₸ · = В работе + ОТК + Менеджер + Ожидания` : '—'}
          color={t.workingCount > 0 ? 'amber' : undefined}
        />
        <Kpi
          label="Проблема"
          value={fmt(t.problemCount)}
          sub={t.problemCount > 0 ? `${fmtCompact(t.problemAmount)} ₸ · ошибки и проблемные` : '—'}
          color={t.problemCount > 0 ? 'red' : undefined}
        />
        <Kpi label="Средний заказ" value={fmtCompact(t.ordersCount > 0 ? t.ordersAmount / t.ordersCount : 0)} suffix="₸" />
      </div>

      {/* Bar list */}
      <div className="panel p-4">
        <div className="text-sm font-semibold text-gray-800 mb-3">Рейтинг упаковщиков (отгружено / в работе / проблема)</div>
        <div className="space-y-2">
          {sortedRows.map((p, i) => {
            const c = COLORS[i % COLORS.length];
            const shippedPct = (p.ordersCount / maxCount) * 100;
            const workingPct = (p.workingCount / maxCount) * 100;
            const problemPct = (p.problemCount / maxCount) * 100;
            return (
              <div key={p.name} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: c }}>
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="w-44 truncate text-sm font-medium" title={p.name}>{p.name}</div>
                <div className="flex-1 h-6 bg-gray-100 rounded relative overflow-hidden flex">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${shippedPct}%`, background: '#10b981', opacity: 0.85 }}
                    title={`Отгружено: ${p.ordersCount}`}
                  />
                  <div
                    className="h-full transition-all"
                    style={{ width: `${workingPct}%`, background: '#f59e0b', opacity: 0.85 }}
                    title={`В работе: ${p.workingCount}`}
                  />
                  <div
                    className="h-full transition-all"
                    style={{ width: `${problemPct}%`, background: '#ef4444', opacity: 0.85 }}
                    title={`Проблема: ${p.problemCount}`}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-xs font-medium text-gray-900">
                    <span className="text-emerald-800">{p.ordersCount}</span>
                    {p.workingCount > 0 && <span className="ml-1 text-amber-800">+ {p.workingCount} в работе</span>}
                    {p.problemCount > 0 && <span className="ml-1 text-rose-700">+ {p.problemCount} проблема</span>}
                    <span className="text-gray-500 ml-auto">{(p.share * 100).toFixed(0)}% доля</span>
                  </div>
                </div>
                <div className="w-24 text-right text-sm tabular-nums text-blue-700 font-semibold">{fmtKg(p.shippedKg)}<span className="text-[10px] text-gray-500 ml-0.5">кг</span></div>
                <div className="w-32 text-right text-sm tabular-nums text-gray-700">{fmtCompact(p.ordersAmount)} ₸</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-xs text-gray-500 flex items-center gap-4">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#10b981' }} /> Отгружено (расходная создана)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#f59e0b' }} /> В работе (ОТК / в работе / в ожидании)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: '#ef4444' }} /> Проблема / ошибка</span>
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="overflow-auto max-h-[60vh]">
          <table className="report w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
              <tr>
                <th className="text-gray-500 w-8 text-right">#</th>
                <SortHeader label="Упаковщик" k="name" align="left" />
                <SortHeader label="Отгружено" k="ordersCount" />
                <SortHeader label="В работе" k="workingCount" />
                <SortHeader label="Проблема" k="problemCount" />
                <SortHeader label="КГ" k="shippedKg" />
                <SortHeader label="Сумма ₸" k="ordersAmount" />
                <SortHeader label="Ср. заказ" k="avgOrder" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((p, i) => {
                const isOpen = expanded.has(p.name);
                return (
                  <Fragment key={p.name}>
                    <tr className="hover:bg-gray-50">
                      <td className="text-gray-400 text-xs num">{i + 1}</td>
                      <td className="font-medium">
                        <button
                          onClick={() => toggleExpand(p.name)}
                          className="inline-flex items-center gap-1 hover:text-brand-700 text-left"
                          title="Показать разбивку по дням"
                        >
                          <span className={'inline-block w-3 text-xs text-gray-400 transition-transform ' + (isOpen ? 'rotate-90' : '')}>▶</span>
                          {p.name}
                        </button>
                      </td>
                      <td className="num text-emerald-700 font-medium">{fmt(p.ordersCount)}</td>
                      <td className="num">
                        {p.workingCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => openPending(p.name)}
                            className="text-amber-700 font-medium underline decoration-amber-300 hover:decoration-amber-600 underline-offset-2 cursor-pointer"
                            title="Показать заказы со статусом в работе / ОТК / в ожидании"
                          >
                            {fmt(p.workingCount)}
                          </button>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="num">
                        {p.problemCount > 0
                          ? <span className="text-rose-700 font-medium">{fmt(p.problemCount)}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="num text-blue-700 font-medium">{fmtKg(p.shippedKg)}</td>
                      <td className="num">{fmt(p.ordersAmount)}</td>
                      <td className="num text-xs text-gray-500">{fmt(p.avgOrder)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/60">
                        <td></td>
                        <td colSpan={7} className="!p-0">
                          <div className="px-4 py-3">
                            <div className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">Разбивка по дням</div>
                            {p.byDay.length === 0 ? (
                              <div className="text-xs text-gray-400">Нет данных</div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="text-xs w-full max-w-2xl">
                                  <thead>
                                    <tr className="text-gray-500">
                                      <th className="text-left font-medium py-1 pr-3">Дата</th>
                                      <th className="text-right font-medium py-1 px-3">Отгружено</th>
                                      <th className="text-right font-medium py-1 px-3">В работе</th>
                                      <th className="text-right font-medium py-1 px-3">Проблема</th>
                                      <th className="text-right font-medium py-1 pl-3">КГ</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.byDay.map((d) => (
                                      <tr key={d.date} className="border-t border-gray-200">
                                        <td className="py-1 pr-3 whitespace-nowrap">{format(parseISO(d.date), 'dd.MM (EEEEEE)')}</td>
                                        <td className="num py-1 px-3 text-emerald-700">{fmt(d.ordersCount)}</td>
                                        <td className="num py-1 px-3">
                                          {d.workingCount > 0
                                            ? <span className="text-amber-700">{fmt(d.workingCount)}</span>
                                            : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="num py-1 px-3">
                                          {d.problemCount > 0
                                            ? <span className="text-rose-700">{fmt(d.problemCount)}</span>
                                            : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="num py-1 pl-3 text-blue-700">{fmtKg(d.shippedKg)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-brand-50 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
              <tr className="total border-t-2 border-brand-200">
                <td></td>
                <td className="font-semibold text-brand-700 uppercase text-xs tracking-wider">Итого</td>
                <td className="num text-emerald-700">{fmt(t.ordersCount)}</td>
                <td className="num text-amber-700">{fmt(t.workingCount)}</td>
                <td className="num text-rose-700">{fmt(t.problemCount)}</td>
                <td className="num text-blue-700">{fmtKg(t.shippedKg)}</td>
                <td className="num">{fmt(t.ordersAmount)}</td>
                <td className="num">{t.ordersCount > 0 ? fmt(t.ordersAmount / t.ordersCount) : '0'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 Методика</div>
        <div className="space-y-1">
          <div><b>Отгружено</b> = расходная накладная <code>Realizacia</code> создана (= товар физически отгружен). Для каждой расходной матчим заказ покупателя по контрагенту с датой отгрузки ± 3 дня — оттуда берём упаковщика.</div>
          <div><b>В работе</b> и <b>Проблема</b> — по полю <code>СостояниеЗаказа</code> из 1С, с теми же бакетами, что и в плашке «Статусы заказов» наверху:</div>
          <div className="ml-3">— <b>В работе</b> = «В работе» + «ОТК Зав Склад» + «ОТК Менеджер» + «В ожидании»</div>
          <div className="ml-3">— <b>Проблема</b> = «Проблема» / «Исправить ошибку» / «Ошибка упаковщик и менед»</div>
          <div>Состояние «Завершен» в эти KPI не входит — такие заказы уже отгружены и попадают в «Отгружено». Поэтому сумма колонок «В работе»+«Проблема» в таблице = сумма соответствующих карточек в плашке статусов вверху.</div>
          <div><b>КГ / Сумма</b>: из <code>RealizaciaItem</code> (фактический вес и сумма отгрузки).</div>
          <div><b>«— без упаковщика —»</b>: расходная без соответствующего заказа покупателя (документ оформлен напрямую) либо заказ без packerName.</div>
        </div>
      </div>

      <Modal
        open={pendingFor !== null}
        onClose={() => { setPendingFor(null); setPendingData(null); }}
        title={pendingFor ? `В работе · ${pendingFor}` : ''}
        subtitle={pendingData
          ? `${pendingData.count} заказов · ${fmt(pendingData.totalAmount)} ₸`
          : pendingLoading ? 'Загрузка…' : ''}
        size="lg"
      >
        {pendingLoading && <div className="text-sm text-gray-500 py-8 text-center">Загрузка…</div>}
        {!pendingLoading && pendingData && pendingData.orders.length === 0 && (
          <div className="text-sm text-gray-500 py-8 text-center">Нет заказов в работе</div>
        )}
        {!pendingLoading && pendingData && pendingData.orders.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Документ</th>
                  <th className="text-left font-medium px-3 py-2">Клиент</th>
                  <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Статус</th>
                  <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Сумма ₸</th>
                </tr>
              </thead>
              <tbody>
                {pendingData.orders.map((o) => (
                  <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-sm">№ {o.number}</div>
                      <div className="text-xs text-gray-500">
                        {format(new Date(o.date), 'dd.MM.yyyy')}
                        {o.shipmentDate && <> · отгр. {format(new Date(o.shipmentDate), 'dd.MM.yyyy')}</>}
                      </div>
                    </td>
                    <td className="px-3 py-2">{o.kontragentName || <span className="text-gray-400">— без клиента —</span>}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">{o.stateName || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(o.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
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

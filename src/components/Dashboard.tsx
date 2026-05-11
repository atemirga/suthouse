'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import {
  IconChart, IconBars, IconPie, IconTable, IconUp, IconDown,
  IconInfo, IconArrowRight, IconRefresh, IconBuilding,
  IconCash, IconCart, IconCoins, IconUsers, IconWarning, IconWallet, IconTrend,
} from './Icons';
import { MultiSeriesChart, PieBreakdown, HorizontalBar, ViewSwitcher } from './Charts';
import Link from 'next/link';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return String(Math.round(n));
};

interface DashboardProps {
  initialData: any;
  lastSync: { status: string; finishedAt: string | null; startedAt: string } | null;
  unmappedCount: number;
}

export default function Dashboard({ initialData, lastSync, unmappedCount }: DashboardProps) {
  const sp = useSearchParams();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [revViewType, setRevViewType] = useState<'area' | 'bar' | 'line'>('area');
  const [expViewType, setExpViewType] = useState<'pie' | 'bar' | 'table'>('pie');
  const [topViewType, setTopViewType] = useState<'customers' | 'products'>('customers');
  const [cfViewType, setCfViewType] = useState<'bar' | 'line'>('bar');

  useEffect(() => {
    const params = new URLSearchParams(sp.toString());
    setLoading(true);
    fetch('/api/dashboard?' + params.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const {
    kpi, deltas, series, expenseBreakdown, inflowBreakdown,
    topCustomers, topProducts,
    receivablesAging, topDebtors, cashPositions, salesByManager,
  } = data;

  const expenseData = expenseBreakdown.map((e: any) => ({ name: e.label, value: e.amount }));
  const inflowData = inflowBreakdown.slice(0, 8).map((i: any) => ({ name: i.article.replace(/^\d+\.\d+\s+/, ''), value: i.amount }));
  const receivablesTotal = kpi.receivablesTotal;

  return (
    <div className="space-y-5">
      {/* Системные предупреждения */}
      {(unmappedCount > 0 || (lastSync && lastSync.status === 'error')) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {unmappedCount > 0 && (
            <Link href="/settings/mapping" className="hint hover:bg-blue-100 transition-colors">
              <IconInfo className="hint-icon" />
              <div className="flex-1">
                <b>{unmappedCount} статей ДДС</b> без категории ОПиУ — расходы могут не учитываться корректно.
              </div>
              <IconArrowRight width={16} height={16} className="text-blue-600 mt-0.5" />
            </Link>
          )}
          {lastSync?.status === 'error' && (
            <div className="hint" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#7f1d1d' }}>
              <IconInfo className="hint-icon" style={{ color: '#dc2626' }} />
              <div className="flex-1">
                <b>Последняя синхронизация завершилась ошибкой.</b>{' '}
                <Link href="/settings/sync" className="underline">Открыть лог →</Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HERO KPIs — 4 главные карточки с градиентами */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroCard
          icon={<IconWallet width={20} height={20} />}
          label="Остаток денег"
          value={fmtCompact(kpi.cashBalance)}
          suffix="₸"
          gradient="from-emerald-500 to-emerald-700"
          sub={`по ${cashPositions.length} ${declension(cashPositions.length, 'кассе', 'кассам', 'кассам')}`}
          link="/dds"
        />
        <HeroCard
          icon={<IconCart width={20} height={20} />}
          label="Выручка"
          value={fmtCompact(kpi.revenue)}
          suffix="₸"
          gradient="from-blue-500 to-blue-700"
          delta={deltas.revenue}
          link="/opiu"
        />
        <HeroCard
          icon={<IconTrend width={20} height={20} />}
          label="Чистая прибыль"
          value={fmtCompact(kpi.netProfit)}
          suffix="₸"
          gradient={kpi.netProfit >= 0 ? 'from-violet-500 to-violet-700' : 'from-rose-500 to-rose-700'}
          delta={deltas.netProfit}
          sub={(kpi.netMargin * 100).toFixed(1) + '% маржа'}
          link="/opiu"
        />
        <HeroCard
          icon={<IconCoins width={20} height={20} />}
          label="Долг клиентов"
          value={fmtCompact(kpi.receivablesTotal)}
          suffix="₸"
          gradient={kpi.receivablesOverdue30 > kpi.receivablesTotal * 0.3 ? 'from-red-500 to-red-700' : 'from-amber-500 to-amber-700'}
          sub={`${kpi.receivablesCount} ${declension(kpi.receivablesCount, 'должник', 'должника', 'должников')} · ${fmtCompact(kpi.receivablesOverdue30)} ₸ просрочка 30+`}
          link="/receivables"
        />
      </div>

      {/* MID KPIs — компактные показатели */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniKpi label="Валовая маржа" value={(kpi.grossMargin * 100).toFixed(1) + '%'} sub={fmtCompact(kpi.grossProfit) + ' ₸'} delta={deltas.grossMargin} />
        <MiniKpi label="EBITDA" value={fmtCompact(kpi.ebitda)} suffix="₸" sub={(kpi.ebitdaMargin * 100).toFixed(1) + '%'} />
        <MiniKpi label="Поступило" value={fmtCompact(kpi.cashIn)} suffix="₸" valueColor="text-emerald-700" />
        <MiniKpi label="Списано" value={fmtCompact(kpi.cashOut)} suffix="₸" valueColor="text-rose-700" />
        <MiniKpi label="Сделок" value={String(kpi.txCount)} sub={fmtCompact(kpi.avgCheck) + ' ₸ ср.чек'} />
        <MiniKpi
          label="Скидки выданы"
          value={fmtCompact(kpi.discountsGiven)}
          suffix="₸"
          sub={kpi.discountsPct > 0 ? kpi.discountsPct.toFixed(2) + '% от вал. выручки' : undefined}
          valueColor="text-amber-700"
        />
      </div>

      {loading && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <IconRefresh className="animate-spin" width={12} height={12} /> Обновляю данные…
        </div>
      )}

      {/* Главный график динамики */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <IconChart width={14} height={14} />
            Динамика выручки и прибыли
            <Tooltip text="Выручка, валовая прибыль, EBITDA и чистая прибыль по периодам" />
          </div>
          <ViewSwitcher
            value={revViewType}
            onChange={(v) => setRevViewType(v as any)}
            options={[
              { key: 'area', label: 'Area', icon: <IconChart width={12} height={12} /> },
              { key: 'line', label: 'Line', icon: <IconChart width={12} height={12} /> },
              { key: 'bar', label: 'Bar', icon: <IconBars width={12} height={12} /> },
            ]}
          />
        </div>
        <div className="p-3">
          <MultiSeriesChart
            data={series}
            series={[
              { key: 'revenue', label: 'Выручка', color: '#3b82f6' },
              { key: 'grossProfit', label: 'Валовая прибыль', color: '#10b981' },
              { key: 'ebitda', label: 'EBITDA', color: '#8b5cf6' },
              { key: 'netProfit', label: 'Чистая прибыль', color: '#f59e0b' },
            ]}
            type={revViewType}
            height={290}
          />
        </div>
      </div>

      {/* Дебиторка + Остатки касс */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* AR Aging snapshot */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconCoins width={14} height={14} />
              Дебиторка — старение долга
              <Tooltip text="Сколько денег должны клиенты и насколько давно. Просрочка 30+ дней требует звонка." />
            </div>
            <Link href="/receivables" className="text-xs text-brand-600 hover:underline flex items-center gap-1">
              Открыть отчёт <IconArrowRight width={12} height={12} />
            </Link>
          </div>
          <div className="p-4 space-y-4">
            {receivablesTotal === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">Дебиторская задолженность отсутствует</div>
            ) : (
              <>
                {/* Stacked bar */}
                <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
                  {receivablesAging.map((b: any) => {
                    const pct = receivablesTotal > 0 ? (b.amount / receivablesTotal) * 100 : 0;
                    if (pct === 0) return null;
                    return (
                      <div key={b.key} style={{ width: `${pct}%`, background: b.color }}
                           title={`${b.label}: ${fmt(b.amount)} ₸`} />
                    );
                  })}
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {receivablesAging.map((b: any) => {
                    const pct = receivablesTotal > 0 ? (b.amount / receivablesTotal) * 100 : 0;
                    return (
                      <div key={b.key} className="text-center">
                        <div className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: b.color }}>
                          {b.label}
                        </div>
                        <div className="text-sm font-bold tabular-nums">{fmtCompact(b.amount)}</div>
                        <div className="text-[10px] text-gray-500">{pct.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
                {/* Top debtors */}
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">Топ должников</div>
                  <div className="space-y-1.5">
                    {topDebtors.slice(0, 5).map((d: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-400 text-xs w-4">{i + 1}</span>
                        <span className="flex-1 truncate">{d.name}</span>
                        <span className={'text-xs tabular-nums ' + (d.oldestDays > 60 ? 'text-red-700 font-medium' : d.oldestDays > 30 ? 'text-amber-700' : 'text-gray-500')}>
                          {d.oldestDays} дн
                        </span>
                        <span className="num font-semibold tabular-nums w-24 text-right">{fmt(d.debt)} ₸</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Cash positions */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconCash width={14} height={14} />
              Остатки по кассам и счетам
              <Tooltip text="Текущий остаток денежных средств в каждой кассе и на каждом банковском счёте" />
            </div>
            <Link href="/dds" className="text-xs text-brand-600 hover:underline flex items-center gap-1">
              Открыть ДДС <IconArrowRight width={12} height={12} />
            </Link>
          </div>
          <div className="p-4">
            {cashPositions.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">Нет данных по остаткам</div>
            ) : (
              <div className="space-y-2">
                {cashPositions.slice(0, 8).map((p: any, i: number) => {
                  const maxAbs = Math.max(...cashPositions.slice(0, 8).map((x: any) => Math.abs(x.balance)));
                  const pct = maxAbs > 0 ? (Math.abs(p.balance) / maxAbs) * 100 : 0;
                  const color = p.type === 'bank' ? '#3b82f6' : '#10b981';
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2 text-sm mb-0.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                        <span className="flex-1 truncate text-xs">{p.name}</span>
                        <span className={'text-xs px-1.5 py-0.5 rounded ' + (p.type === 'bank' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700')}>
                          {p.type === 'bank' ? 'Банк' : 'Касса'}
                        </span>
                        <span className={'tabular-nums font-semibold text-sm ' + (p.balance < 0 ? 'text-red-700' : 'text-gray-900')}>
                          {fmt(p.balance)} ₸
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, opacity: 0.7 }} />
                      </div>
                    </div>
                  );
                })}
                {cashPositions.length > 8 && (
                  <div className="text-xs text-gray-500 pt-1">…ещё {cashPositions.length - 8}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Структура расходов + Денежный поток */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconPie width={14} height={14} />
              Структура расходов
              <Tooltip text="Распределение всех расходов по категориям ОПиУ" />
            </div>
            <ViewSwitcher
              value={expViewType}
              onChange={(v) => setExpViewType(v as any)}
              options={[
                { key: 'pie', label: '', icon: <IconPie width={14} height={14} /> },
                { key: 'bar', label: '', icon: <IconBars width={14} height={14} /> },
                { key: 'table', label: '', icon: <IconTable width={14} height={14} /> },
              ]}
            />
          </div>
          <div className="p-3">
            {expenseData.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">Нет данных за период</div>
            ) : expViewType === 'pie' ? (
              <PieBreakdown data={expenseData} />
            ) : expViewType === 'bar' ? (
              <HorizontalBar data={expenseData} />
            ) : (
              <CategoryTable data={expenseData} />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconBars width={14} height={14} />
              Денежный поток · приход / расход
              <Tooltip text="Сравнение поступлений и списаний денежных средств" />
            </div>
            <ViewSwitcher
              value={cfViewType}
              onChange={(v) => setCfViewType(v as any)}
              options={[
                { key: 'bar', label: '', icon: <IconBars width={14} height={14} /> },
                { key: 'line', label: '', icon: <IconChart width={14} height={14} /> },
              ]}
            />
          </div>
          <div className="p-3">
            <MultiSeriesChart
              data={series}
              series={[
                { key: 'cashIn', label: 'Поступления', color: '#10b981' },
                { key: 'cashOut', label: 'Списания', color: '#ef4444' },
              ]}
              type={cfViewType}
              height={260}
            />
          </div>
        </div>
      </div>

      {/* Продажи по менеджерам */}
      {salesByManager.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconUsers width={14} height={14} />
              Продажи по менеджерам
              <Tooltip text="Выручка, количество сделок и средний чек по каждому ответственному за период" />
            </div>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {salesByManager.slice(0, 8).map((m: any, i: number) => {
                const maxRev = salesByManager[0]?.revenue || 1;
                const pct = (m.revenue / maxRev) * 100;
                const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f97316'];
                const c = colors[i % colors.length];
                return (
                  <div key={i} className="border border-gray-200 rounded-lg p-3 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: c }}>
                        {m.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{m.name}</div>
                        <div className="text-[11px] text-gray-500">{m.orders} {declension(m.orders, 'сделка', 'сделки', 'сделок')}</div>
                      </div>
                    </div>
                    <div className="text-lg font-bold tabular-nums">{fmtCompact(m.revenue)} <span className="text-xs text-gray-500">₸</span></div>
                    <div className="text-[11px] text-gray-500">Ср. чек: {fmtCompact(m.avgCheck)} ₸</div>
                    <div className="h-1 rounded-full bg-gray-100 overflow-hidden mt-2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Топы */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconCart width={14} height={14} />
              Топ-{topViewType === 'customers' ? 'клиентов' : 'товаров'}
            </div>
            <ViewSwitcher
              value={topViewType}
              onChange={(v) => setTopViewType(v as any)}
              options={[
                { key: 'customers', label: 'Клиенты' },
                { key: 'products', label: 'Товары' },
              ]}
            />
          </div>
          <div className="p-3">
            <table className="report">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>{topViewType === 'customers' ? 'Контрагент' : 'Товар'}</th>
                  <th className="text-right">Выручка</th>
                  {topViewType === 'customers'
                    ? <th className="text-right">Сделок</th>
                    : <th className="text-right">Маржа</th>}
                </tr>
              </thead>
              <tbody>
                {(topViewType === 'customers' ? topCustomers : topProducts).slice(0, 10).map((row: any, i: number) => (
                  <tr key={i}>
                    <td className="text-gray-400 text-xs">{i + 1}</td>
                    <td className="text-xs">{row.name}</td>
                    <td className="num">{fmt(row.revenue)}</td>
                    {topViewType === 'customers'
                      ? <td className="num text-xs text-gray-500">{row.orders}</td>
                      : <td className="num text-xs"><span className={row.margin > 0 ? 'text-green-700' : 'text-red-700'}>{(row.margin * 100).toFixed(1)}%</span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconCoins width={14} height={14} />
              Поступления по статьям ДДС
              <Tooltip text="Структура входящих платежей по статьям" />
            </div>
          </div>
          <div className="p-3">
            {inflowData.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">Нет данных</div>
            ) : (
              <HorizontalBar data={inflowData} height={300} />
            )}
          </div>
        </div>
      </div>

      {/* Состояние системы */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <IconBuilding width={14} height={14} /> Состояние системы
          </div>
          <Link href="/settings/sync" className="text-xs text-brand-600 hover:underline flex items-center gap-1">
            Подробнее <IconArrowRight width={12} height={12} />
          </Link>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Последняя синхронизация</div>
            <div className="flex items-center gap-2">
              {lastSync ? (
                <>
                  <span className={'pill ' + (lastSync.status === 'success' ? 'pill-green' : lastSync.status === 'error' ? 'pill-red' : 'pill-amber')}>
                    {lastSync.status === 'success' ? 'успех' : lastSync.status === 'error' ? 'ошибка' : 'идёт'}
                  </span>
                  <span className="text-gray-700 text-xs">
                    {format(new Date(lastSync.finishedAt || lastSync.startedAt), 'dd.MM.yyyy HH:mm')}
                  </span>
                </>
              ) : (
                <span className="text-gray-400 text-xs">синхронизация ещё не запускалась</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Активных заказов</div>
            <div className="text-lg font-semibold">{kpi.activeOrders}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Неразмеченных статей</div>
            <div className={'text-lg font-semibold ' + (unmappedCount > 0 ? 'text-amber-600' : 'text-green-600')}>{unmappedCount}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroCard({
  icon, label, value, suffix, sub, delta, gradient, link,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  delta?: number;
  gradient: string;
  link?: string;
}) {
  const body = (
    <div className={`bg-gradient-to-br ${gradient} text-white rounded-2xl p-5 shadow-sm relative overflow-hidden transition-transform ${link ? 'hover:scale-[1.01] hover:shadow-md cursor-pointer' : ''}`}>
      <div className="absolute top-0 right-0 opacity-10 -mr-4 -mt-4">
        <div className="w-28 h-28">{icon && <div style={{ transform: 'scale(5)' }}>{icon}</div>}</div>
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 mb-3 opacity-90">
          {icon}
          <div className="text-xs font-medium uppercase tracking-wider">{label}</div>
        </div>
        <div className="text-3xl font-bold tabular-nums">
          {value}{suffix && <span className="text-lg font-semibold opacity-70 ml-1">{suffix}</span>}
        </div>
        {sub && <div className="text-xs opacity-80 mt-1">{sub}</div>}
        {delta !== undefined && Math.abs(delta) > 0.5 && (
          <div className="text-xs mt-2 flex items-center gap-1 bg-white/15 px-2 py-0.5 rounded-full w-fit">
            {delta > 0 ? <IconUp width={11} height={11} /> : <IconDown width={11} height={11} />}
            {Math.abs(delta).toFixed(1)}% к пред.
          </div>
        )}
      </div>
    </div>
  );
  return link ? <Link href={link}>{body}</Link> : body;
}

function MiniKpi({
  label, value, suffix, sub, delta, valueColor,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  delta?: number;
  valueColor?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 hover:border-gray-300 transition-colors">
      <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">{label}</div>
      <div className={'text-xl font-bold tabular-nums ' + (valueColor || 'text-gray-900')}>
        {value}{suffix && <span className="text-xs font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
      {delta !== undefined && Math.abs(delta) > 0.5 && (
        <div className={'text-[11px] mt-0.5 flex items-center gap-0.5 ' + (delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>
          {delta > 0 ? <IconUp width={10} height={10} /> : <IconDown width={10} height={10} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="has-tooltip">
      <IconInfo width={12} height={12} className="text-gray-400 hover:text-brand-600 cursor-help" />
      <span className="tooltip">{text}</span>
    </span>
  );
}

function CategoryTable({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <table className="report">
      <thead>
        <tr><th>Категория</th><th className="text-right">Сумма</th><th className="text-right w-20">Доля</th></tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.name}>
            <td>{d.name}</td>
            <td className="num">{fmt(d.value)} ₸</td>
            <td className="num text-xs text-gray-500">{((d.value / total) * 100).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function declension(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

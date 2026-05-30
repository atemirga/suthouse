'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
  return Math.round(n).toLocaleString('ru-RU');
};

const REFRESH_INTERVAL_MS = 60_000;

type SyncInfo = { status: string; finishedAt: string | null; startedAt: string } | null;

function formatAgo(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return 'только что';
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  return `${Math.floor(hr / 24)} д назад`;
}

interface DashboardProps {
  initialData: any;
  lastSync: SyncInfo;
  unmappedCount: number;
}

export default function Dashboard({ initialData, lastSync: initialLastSync, unmappedCount: initialUnmapped }: DashboardProps) {
  const sp = useSearchParams();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<SyncInfo>(initialLastSync);
  const [unmappedCount, setUnmappedCount] = useState(initialUnmapped);
  const [fetchedAt, setFetchedAt] = useState<Date>(new Date());
  const [now, setNow] = useState<Date>(new Date());
  const [revViewType, setRevViewType] = useState<'area' | 'bar' | 'line'>('area');
  const [expViewType, setExpViewType] = useState<'pie' | 'bar' | 'table'>('pie');
  const [topViewType, setTopViewType] = useState<'customers' | 'products'>('customers');
  const [cfViewType, setCfViewType] = useState<'bar' | 'line'>('bar');
  const inFlight = useRef(false);

  const refresh = (signal?: AbortSignal) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const params = new URLSearchParams(sp.toString());
    setLoading(true);
    return fetch('/api/dashboard?' + params.toString(), { signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        setData(d);
        if (d.lastSync !== undefined) setLastSync(d.lastSync);
        if (typeof d.unmappedCount === 'number') setUnmappedCount(d.unmappedCount);
        setFetchedAt(d.fetchedAt ? new Date(d.fetchedAt) : new Date());
      })
      .catch((e) => { if (e?.name !== 'AbortError') throw e; })
      .finally(() => { setLoading(false); inFlight.current = false; });
  };

  // Refetch on period change
  useEffect(() => {
    const ctl = new AbortController();
    refresh(ctl.signal);
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  // Auto-refresh every REFRESH_INTERVAL_MS, pause when tab hidden
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  // Refresh when tab regains focus (after being hidden)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedAt.getTime() > 30_000) {
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedAt]);

  // Tick "now" every 10s so "обновлено N сек назад" stays current
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const {
    kpi, deltas, series, heroSpark, salesDaily = [], expenseBreakdown, inflowBreakdown,
    topCustomers, topProducts,
    receivablesAging, topDebtors, cashPositions, salesByManager,
    orderStates = [],
  } = data;
  const orderStatesTotal = orderStates.reduce((s: number, r: any) => s + r.count, 0);
  const orderStateColor = (b: string) =>
    b === 'done' ? '#10b981' : b === 'inProgress' ? '#3b82f6' : b === 'problem' ? '#ef4444' : '#9ca3af';

  const lastSyncDate = lastSync ? new Date(lastSync.finishedAt || lastSync.startedAt) : null;
  const dataAgeMs = lastSyncDate ? now.getTime() - lastSyncDate.getTime() : null;
  const fetchAgeMs = now.getTime() - fetchedAt.getTime();

  const expenseData = expenseBreakdown.map((e: any) => ({ name: e.label, value: e.amount }));
  const inflowData = inflowBreakdown.slice(0, 8).map((i: any) => ({ name: i.article.replace(/^\d+\.\d+\s+/, ''), value: i.amount }));
  const receivablesTotal = kpi.receivablesTotal;

  // Мини-тренды для hero-карточек: дневные (heroSpark), с откатом на месячные series
  const cashSpark = heroSpark?.cash?.length ? heroSpark.cash : series.map((s: any) => (s.cashIn || 0) - (s.cashOut || 0));
  const revenueSpark = heroSpark?.revenue?.length ? heroSpark.revenue : series.map((s: any) => s.revenue || 0);
  const profitSpark = heroSpark?.profit?.length ? heroSpark.profit : series.map((s: any) => s.netProfit || 0);

  const isStale = dataAgeMs !== null && dataAgeMs > 45 * 60 * 1000;
  const syncErrored = lastSync?.status === 'error';

  return (
    <div className="space-y-5">
      {/* Свежесть данных + ручное обновление */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-2 text-gray-600">
          <span
            className={
              'inline-block w-2 h-2 rounded-full ' +
              (syncErrored ? 'bg-red-500' : isStale ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse')
            }
            title={
              syncErrored
                ? 'Последняя синхронизация с 1С завершилась ошибкой'
                : isStale
                  ? 'Данные не обновлялись из 1С больше 45 минут'
                  : 'Синхронизация с 1С идёт по расписанию'
            }
          />
          {lastSyncDate ? (
            <>
              <span>
                Данные из 1С на{' '}
                <b className="text-gray-900">{format(lastSyncDate, 'dd.MM HH:mm')}</b>
                {dataAgeMs !== null && (
                  <span className="text-gray-500"> · {formatAgo(dataAgeMs)}</span>
                )}
              </span>
            </>
          ) : (
            <span className="text-gray-400">Синхронизация ещё не запускалась</span>
          )}
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">
            Экран обновлён {formatAgo(fetchAgeMs)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700"
          title="Обновить сейчас"
        >
          <IconRefresh
            width={12}
            height={12}
            className={loading ? 'animate-spin' : ''}
          />
          {loading ? 'Обновляю…' : 'Обновить'}
        </button>
      </div>

      {/* Системные предупреждения */}
      {(unmappedCount > 0 || (lastSync && lastSync.status === 'error')) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {unmappedCount > 0 && (
            <Link href="/settings/mapping" className="hint hover:bg-blue-100 transition-colors">
              <IconInfo className="hint-icon" />
              <div className="flex-1">
                <b>{fmt(unmappedCount)} статей ДДС</b> без категории ОПиУ — расходы могут не учитываться корректно.
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <HeroCard
          icon={<IconWallet width={20} height={20} />}
          label="Остаток денег"
          amount={kpi.cashBalance}
          suffix="₸"
          gradient="from-emerald-500 to-emerald-700"
          spark={cashSpark}
          sub={`по ${cashPositions.length} ${declension(cashPositions.length, 'кассе', 'кассам', 'кассам')}`}
          link="/dds"
        />
        <HeroCard
          icon={<IconCart width={20} height={20} />}
          label="Выручка"
          amount={kpi.revenue}
          suffix="₸"
          gradient="from-blue-500 to-blue-700"
          delta={deltas.revenue}
          spark={revenueSpark}
          link="/opiu"
        />
        <HeroCard
          icon={<IconTrend width={20} height={20} />}
          label="Чистая прибыль"
          amount={kpi.netProfit}
          suffix="₸"
          gradient={kpi.netProfit >= 0 ? 'from-violet-500 to-violet-700' : 'from-rose-500 to-rose-700'}
          delta={deltas.netProfit}
          spark={profitSpark}
          sub={(kpi.netMargin * 100).toFixed(1) + '% маржа'}
          link="/opiu"
        />
        <HeroCard
          icon={<IconCoins width={20} height={20} />}
          label="Долг клиентов"
          amount={kpi.receivablesTotal}
          suffix="₸"
          gradient={kpi.receivablesOverdue30 > kpi.receivablesTotal * 0.3 ? 'from-red-500 to-red-700' : 'from-amber-500 to-amber-700'}
          sub={`${kpi.receivablesCount} ${declension(kpi.receivablesCount, 'должник', 'должника', 'должников')} · ${fmtCompact(kpi.receivablesOverdue30)} ₸ просрочка 30+`}
          link="/receivables"
        />
      </div>

      {/* MID KPIs — компактные показатели */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 stagger">
        <MiniKpi label="Валовая маржа" value={(kpi.grossMargin * 100).toFixed(1) + '%'} sub={fmtCompact(kpi.grossProfit) + ' ₸'} delta={deltas.grossMargin} />
        <MiniKpi label="EBITDA" value={fmtCompact(kpi.ebitda)} suffix="₸" sub={(kpi.ebitdaMargin * 100).toFixed(1) + '%'} />
        <MiniKpi label="Поступило" value={fmtCompact(kpi.cashIn)} suffix="₸" valueColor="text-emerald-700" />
        <MiniKpi label="Списано" value={fmtCompact(kpi.cashOut)} suffix="₸" valueColor="text-rose-700" />
        <MiniKpi label="Сделок" value={fmt(kpi.txCount)} sub={fmtCompact(kpi.avgCheck) + ' ₸ ср.чек'} />
        <MiniKpi
          label="Скидки выданы"
          value={fmtCompact(kpi.discountsGiven)}
          suffix="₸"
          sub={kpi.discountsPct > 0 ? kpi.discountsPct.toFixed(2) + '% от вал. выручки' : undefined}
          valueColor="text-amber-700"
        />
      </div>

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

      {/* Карта продаж по дням — на всю ширину */}
      <div className="panel anim-rise" style={{ animationDelay: '0.08s' }}>
        <div className="panel-header">
          <div className="panel-title">
            <IconChart width={14} height={14} />
            Карта продаж по дням
            <Tooltip text="Дневная выручка за период: чем насыщеннее клетка, тем больше продаж в этот день" />
          </div>
        </div>
        <div className="p-4">
          <SalesHeatmap data={salesDaily} />
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
              <PieBreakdown data={expenseData} centerLabel="Расходы" />
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

      {/* Заказы по статусам */}
      {orderStatesTotal > 0 && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <IconCart width={14} height={14} />
              Заказы покупателей — статусы за период
              <Tooltip text="Состояния заказов из 1С (Catalog_СостоянияЗаказовПокупателей). «Активные» = в работе + проблемные." />
            </div>
            <div className="text-xs text-gray-500">Всего {orderStatesTotal}</div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
              {orderStates.map((r: any) => {
                const pct = orderStatesTotal > 0 ? (r.count / orderStatesTotal) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div
                    key={r.state}
                    style={{ width: `${pct}%`, background: orderStateColor(r.bucket) }}
                    title={`${r.state}: ${r.count} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {orderStates.map((r: any) => {
                const pct = orderStatesTotal > 0 ? (r.count / orderStatesTotal) * 100 : 0;
                return (
                  <div
                    key={r.state}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-gray-100 bg-white"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: orderStateColor(r.bucket) }}
                    />
                    <span className="text-xs flex-1 truncate" title={r.state}>{r.state}</span>
                    <span className="text-xs font-semibold tabular-nums">{fmt(r.count)}</span>
                    <span className="text-[10px] text-gray-400 tabular-nums w-9 text-right">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
                      ? <td className="num text-xs text-gray-500">{fmt(row.orders)}</td>
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
            <div className="text-lg font-semibold">{fmt(kpi.activeOrders)}</div>
            <div className="text-[11px] text-gray-500">в работе и проблемных за период</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Неразмеченных статей</div>
            <div className={'text-lg font-semibold ' + (unmappedCount > 0 ? 'text-amber-600' : 'text-green-600')}>{fmt(unmappedCount)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Плавный счётчик от 0 до target (count-up при появлении карточки)
function useCountUp(target: number, durationMs = 900): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const from = fromRef.current;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (target - from) * eased;
      setVal(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);
  return val;
}

// Мини-спарклайн на чистом SVG: area-glow заливка + линия (wipe-анимация) + точка на конце
function Sparkline({ data, className = '' }: { data: number[]; className?: string }) {
  const uid = useId().replace(/:/g, '');
  if (!data || data.length < 2) return null;
  const w = 100;
  const h = 30;
  const pad = 3; // чтобы линия и точка не обрезались сверху/снизу
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const xy = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: pad + (h - 2 * pad) - ((v - min) / range) * (h - 2 * pad),
  }));
  const line = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} ${w},${h} 0,${h}`;
  const last = xy[xy.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`w-full h-8 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`sg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <g className="spark-wipe">
        <polygon points={area} fill={`url(#sg-${uid})`} className="spark-fill" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="opacity-90"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <circle
        cx={last.x}
        cy={last.y}
        r={2.4}
        fill="#fff"
        stroke="currentColor"
        strokeWidth={1.5}
        className="spark-dot"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function HeroCard({
  icon, label, amount, suffix, sub, delta, gradient, link, spark,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number;
  suffix?: string;
  sub?: string;
  delta?: number;
  gradient: string;
  link?: string;
  spark?: number[];
}) {
  const animated = useCountUp(amount);
  const body = (
    <div className={`h-full flex flex-col bg-gradient-to-br ${gradient} text-white rounded-2xl p-5 shadow-sm relative overflow-hidden transition-transform ${link ? 'hover:scale-[1.01] hover:shadow-md cursor-pointer' : ''}`}>
      <div className="absolute top-0 right-0 opacity-10 -mr-4 -mt-4">
        <div className="w-28 h-28">{icon && <div style={{ transform: 'scale(5)' }}>{icon}</div>}</div>
      </div>
      <div className="relative flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-3 opacity-90">
          {icon}
          <div className="text-xs font-medium uppercase tracking-wider">{label}</div>
        </div>
        <div className="text-3xl font-bold tabular-nums">
          {fmtCompact(animated)}{suffix && <span className="text-lg font-semibold opacity-70 ml-1">{suffix}</span>}
        </div>
        {sub && <div className="text-xs opacity-80 mt-1">{sub}</div>}
        {delta !== undefined && Math.abs(delta) > 0.5 && (
          <div className="text-xs mt-2 flex items-center gap-1 bg-white/15 px-2 py-0.5 rounded-full w-fit">
            {delta > 0 ? <IconUp width={11} height={11} /> : <IconDown width={11} height={11} />}
            {Math.abs(delta).toFixed(1)}% к пред.
          </div>
        )}
        {/* Спарклайн всегда прижат к низу; место резервируется даже без него — карточки равной высоты */}
        <div className="mt-auto pt-3 -mb-1 h-8">
          {spark && spark.length >= 2 && <Sparkline data={spark} />}
        </div>
      </div>
    </div>
  );
  return link ? <Link href={link} className="block h-full">{body}</Link> : body;
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

// Карта продаж: дни недели — по вертикали (7 строк), недели/дни месяца — по горизонтали.
// Колонки-недели тянутся на всю ширину; на узких экранах — горизонтальный скролл.
function SalesHeatmap({ data }: { data: { date: string; revenue: number }[] }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-gray-500 py-8 text-center">Нет данных за период</div>;
  }
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const total = data.reduce((s, d) => s + d.revenue, 0);
  const best = data.reduce((a, b) => (b.revenue > a.revenue ? b : a), data[0]);
  const avg = total / data.length;

  const parse = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d, dow: (new Date(y, m - 1, d).getDay() + 6) % 7 }; // dow: 0 = Пн
  };
  const firstOffset = parse(data[0].date).dow;
  const numWeeks = Math.ceil((firstOffset + data.length) / 7);
  const fmtDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}.${m}`; };

  // 0 = нет продаж, 1..4 — растущая насыщенность зелёного
  const level = (rev: number) => {
    if (rev <= 0) return 0;
    const t = rev / max;
    return t >= 0.75 ? 4 : t >= 0.5 ? 3 : t >= 0.25 ? 2 : 1;
  };
  const BG = ['#f8fafc', '#dcfce7', '#86efac', '#22c55e', '#15803d'];
  const FG = ['#94a3b8', '#166534', '#14532d', '#ffffff', '#ffffff'];
  const dowLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const ROWS = 'repeat(7, 2.1rem)';

  return (
    <div>
      {/* Сводка сверху (на мобиле — в столбик) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {[
          { l: 'Всего за период', v: fmtCompact(total) + ' ₸' },
          { l: 'В среднем в день', v: fmtCompact(avg) + ' ₸' },
          { l: 'Лучший день', v: `${fmtDate(best.date)} · ${fmtCompact(best.revenue)} ₸` },
        ].map((s) => (
          <div key={s.l} className="bg-gray-50 rounded-lg px-3 py-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">{s.l}</div>
            <div className="text-sm sm:text-base font-bold tabular-nums text-gray-900">{s.v}</div>
          </div>
        ))}
      </div>

      {/* Развёрнутый календарь: дни недели слева вертикально, месяц — слева направо */}
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex gap-1">
          {/* Подписи дней недели (вертикально) */}
          <div className="grid shrink-0 gap-1 pr-1" style={{ gridTemplateRows: ROWS }}>
            {dowLabels.map((l) => (
              <div key={l} className="flex items-center text-[10px] text-gray-400 font-medium">{l}</div>
            ))}
          </div>
          {/* Клетки: колонки-недели тянутся на всю ширину (мин. 40px для скролла на мобиле) */}
          <div
            className="grid flex-1 gap-1"
            style={{ gridTemplateColumns: `repeat(${numWeeks}, minmax(40px, 1fr))`, gridTemplateRows: ROWS, gridAutoFlow: 'column' }}
          >
            {Array.from({ length: firstOffset }).map((_, i) => <div key={'pad' + i} />)}
            {data.map((d) => {
              const lv = level(d.revenue);
              const day = parse(d.date).d;
              return (
                <div
                  key={d.date}
                  className="rounded-md px-1.5 py-1 flex flex-col justify-between overflow-hidden transition-transform hover:scale-[1.04] hover:ring-2 hover:ring-emerald-300 cursor-default"
                  style={{ background: BG[lv], color: FG[lv] }}
                  title={`${fmtDate(d.date)}: ${fmt(d.revenue)} ₸`}
                >
                  <span className="text-[10px] font-semibold opacity-80 leading-none">{day}</span>
                  <span className="text-[9px] sm:text-[10px] font-bold tabular-nums leading-none text-right truncate">
                    {d.revenue > 0 ? fmtCompact(d.revenue) : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Легенда */}
      <div className="flex items-center gap-1.5 mt-3 text-[10px] text-gray-400">
        <span>меньше</span>
        {BG.map((c) => (
          <span key={c} className="w-3.5 h-3.5 rounded-[3px] inline-block border border-gray-200" style={{ background: c }} />
        ))}
        <span>больше</span>
      </div>
    </div>
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

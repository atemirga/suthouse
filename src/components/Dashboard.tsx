'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  IconChart, IconBars, IconPie, IconTable, IconUp, IconDown,
  IconInfo, IconArrowRight, IconRefresh, IconBuilding, IconClock,
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

  // refetch при смене параметров URL
  useEffect(() => {
    const params = new URLSearchParams(sp.toString());
    setLoading(true);
    fetch('/api/dashboard?' + params.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const { kpi, deltas, series, expenseBreakdown, inflowBreakdown, topCustomers, topProducts } = data;

  // Подготовка данных для графиков
  const expenseData = expenseBreakdown.map((e: any) => ({ name: e.label, value: e.amount }));
  const inflowData = inflowBreakdown.slice(0, 8).map((i: any) => ({ name: i.article.replace(/^\d+\.\d+\s+/, ''), value: i.amount }));
  const customerData = topCustomers.slice(0, 8).map((c: any) => ({ name: c.name, value: c.revenue }));
  const productData = topProducts.slice(0, 8).map((p: any) => ({ name: p.name, value: p.revenue }));

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

      {/* KPI карточки */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-3">
        <KpiCard label="Выручка" value={fmtCompact(kpi.revenue)} suffix="₸" delta={deltas.revenue} hint="Сумма из проведённых расходных накладных за период" />
        <KpiCard label="Валовая маржа" value={(kpi.grossMargin * 100).toFixed(1) + '%'} sub={fmtCompact(kpi.grossProfit) + ' ₸'} hint="Валовая прибыль / Выручка. Сколько % выручки остаётся после себестоимости" />
        <KpiCard label="EBITDA" value={fmtCompact(kpi.ebitda)} suffix="₸" sub={(kpi.ebitdaMargin * 100).toFixed(1) + '% маржа'} hint="Опер. прибыль до амортизации, налогов и процентов" />
        <KpiCard label="Чистая прибыль" value={fmtCompact(kpi.netProfit)} suffix="₸" delta={deltas.netProfit} hint="Итоговая прибыль после всех расходов" />
        <KpiCard label="Денежный поток" value={fmtCompact(kpi.netCashFlow)} suffix="₸" delta={deltas.netCashFlow} hint="Поступления − Списания за период" />
        <KpiCard label="Поступило" value={fmtCompact(kpi.cashIn)} suffix="₸" hint="Все приходы денег за период" colorPositive />
        <KpiCard label="Списано" value={fmtCompact(kpi.cashOut)} suffix="₸" hint="Все расходы денег за период" colorNegative />
        <KpiCard label="Сделок · Сред. чек" value={String(kpi.txCount)} sub={fmtCompact(kpi.avgCheck) + ' ₸ ср. чек'} hint="Количество реализаций и средняя сумма" />
      </div>

      {loading && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <IconRefresh className="animate-spin" width={12} height={12} /> Обновляю данные…
        </div>
      )}

      {/* Динамика выручки */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            Динамика выручки и прибыли
            <Tooltip text="Выручка, валовая прибыль, EBITDA и чистая прибыль по периодам. Помогает увидеть тренд." />
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
            height={300}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Структура расходов */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              Структура расходов
              <Tooltip text="Распределение всех расходов по категориям ОПиУ за выбранный период" />
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

        {/* Денежный поток */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              Денежный поток · приход / расход
              <Tooltip text="Сравнение поступлений и списаний денежных средств по периодам" />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Топ контрагентов / товаров */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              Топ-{topViewType === 'customers' ? 'клиентов' : 'товаров'}
              <Tooltip text="Лучшие по выручке за период. Переключите вид на товары." />
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

        {/* Поступления по статьям */}
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title">
              Поступления по статьям ДДС
              <Tooltip text="Структура входящих платежей по статьям движения денежных средств" />
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

      {/* Системная инфо */}
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

function KpiCard({
  label, value, suffix, sub, delta, hint, colorPositive, colorNegative,
}: {
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  delta?: number;
  hint?: string;
  colorPositive?: boolean;
  colorNegative?: boolean;
}) {
  const valColor = colorPositive ? 'text-green-700' : colorNegative ? 'text-red-700' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label flex items-center gap-1">
        {label}
        {hint && <Tooltip text={hint} />}
      </div>
      <div className={'kpi-value ' + valColor}>
        {value}{suffix && <span className="text-base font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      {delta !== undefined && Math.abs(delta) > 0.5 && (
        <div className={'kpi-trend ' + (delta > 0 ? 'text-green-600' : 'text-red-600')}>
          {delta > 0 ? <IconUp width={12} height={12} /> : <IconDown width={12} height={12} />}
          {Math.abs(delta).toFixed(1)}% к пред. периоду
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

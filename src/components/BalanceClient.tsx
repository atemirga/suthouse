'use client';

import { useEffect, useState } from 'react';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + ' тыс';
  return sign + Math.round(abs).toLocaleString('ru-RU');
};

export default function BalanceClient({ initial }: { initial: any }) {
  const [data, setData] = useState(initial);
  const [asOf, setAsOf] = useState<string>(initial.asOf.slice(0, 10));
  const [loading, setLoading] = useState(false);

  function changeDate(newDate: string) {
    setAsOf(newDate);
    setLoading(true);
    fetch('/api/balance?asOf=' + new Date(newDate).toISOString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }

  const a = data.assets;
  const l = data.liabilities;
  const eq = data.equity;
  const totalAssets = a.total;
  const totalLiab = l.total;

  // Доли активов
  const assetRows = [
    { key: 'cash',          label: 'Деньги (касса/банк)',  value: a.cash,           color: '#10b981' },
    { key: 'inventory',     label: 'Товары на складе',     value: a.inventory,      color: '#3b82f6' },
    { key: 'receivables',   label: 'Дебиторка (нам должны клиенты)', value: a.receivables, color: '#f59e0b' },
    { key: 'prepaymentsOut', label: 'Авансы поставщикам',  value: a.prepaymentsOut, color: '#06b6d4' },
    { key: 'fixedAssets',   label: 'Техника, мебель и т.п.', value: a.fixedAssets,  color: '#8b5cf6' },
  ];
  const liabRows = [
    { key: 'payables',       label: 'Кредиторка (мы должны поставщикам)', value: l.payables,      color: '#ef4444' },
    { key: 'prepaymentsIn',  label: 'Авансы от клиентов',                 value: l.prepaymentsIn, color: '#f97316' },
  ];

  return (
    <div className="space-y-5">
      {/* Фильтр даты */}
      <div className="panel">
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">На дату</div>
            <input
              type="date"
              value={asOf}
              onChange={(e) => changeDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            />
          </div>
          {loading && <div className="text-xs text-gray-500">Обновляю…</div>}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Kpi label="Всего активов" value={fmtCompact(totalAssets)} suffix="₸" color="blue" bold />
        <Kpi label="Обязательств" value={fmtCompact(totalLiab)} suffix="₸" color="red" bold />
        <Kpi label="Капитал" value={fmtCompact(eq)} suffix="₸" color={eq >= 0 ? 'green' : 'red'} bold sub="Активы − Пассивы" />
      </div>

      {/* Активы и пассивы рядом */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Активы" total={totalAssets} colorClass="text-blue-700">
          {assetRows.map((r) => (
            <SegmentRow key={r.key} label={r.label} value={r.value} total={totalAssets} color={r.color} />
          ))}
        </SectionCard>
        <SectionCard title="Пассивы" total={totalLiab} colorClass="text-rose-700">
          {liabRows.map((r) => (
            <SegmentRow key={r.key} label={r.label} value={r.value} total={totalLiab} color={r.color} />
          ))}
          <div className="mt-4 pt-3 border-t border-gray-200">
            <div className="text-xs text-gray-500 mb-1">Капитал (баланс)</div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Активы − Пассивы</span>
              <span className={'text-xl font-bold tabular-nums ' + (eq >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                {fmt(eq)} ₸
              </span>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Детализация: деньги */}
      <Panel title={`Деньги — ${fmtCompact(a.cash)} ₸`} subtitle={`${data.cashPositions.length} касс / счетов`}>
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Касса / счёт</th>
              <th className="text-left">Тип</th>
              <th className="text-right">Остаток ₸</th>
              <th className="text-right">% от денег</th>
            </tr>
          </thead>
          <tbody>
            {data.cashPositions.map((p: any) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="font-medium">{p.name}</td>
                <td className="text-xs text-gray-500">{p.type === 'bank' ? 'банк' : 'касса'}</td>
                <td className={'num font-semibold ' + (p.balance < 0 ? 'text-rose-700' : '')}>{fmt(p.balance)}</td>
                <td className="num text-xs text-gray-500">{a.cash > 0 ? ((p.balance / a.cash) * 100).toFixed(1) : '0'}%</td>
              </tr>
            ))}
            {data.cashPositions.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-4">Нет данных</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="total">
              <td colSpan={2}>Итого</td>
              <td className="num">{fmt(a.cash)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </Panel>

      {/* Детализация: товары */}
      <Panel title={`Товары — ${fmtCompact(a.inventory)} ₸`} subtitle={`${data.warehouses.length} складов`}>
        <table className="report w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Склад</th>
              <th className="text-right">Позиций</th>
              <th className="text-right">Остаток, кг</th>
              <th className="text-right">Себестоимость ₸</th>
            </tr>
          </thead>
          <tbody>
            {data.warehouses.map((w: any) => (
              <tr key={w.name} className="hover:bg-gray-50">
                <td className="font-medium">{w.name}</td>
                <td className="num text-xs">{fmt(w.positions)}</td>
                <td className="num">{fmt(w.quantity)}</td>
                <td className="num font-semibold">{fmt(w.costAmount)}</td>
              </tr>
            ))}
            {data.warehouses.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-4">Нет данных</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="total">
              <td>Итого</td>
              <td className="num">{fmt(data.warehouses.reduce((s: number, w: any) => s + w.positions, 0))}</td>
              <td className="num">{fmt(data.warehouses.reduce((s: number, w: any) => s + w.quantity, 0))}</td>
              <td className="num">{fmt(a.inventory)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="text-[11px] text-gray-500 mt-2">
          Себестоимость = остаток × последняя цена закупки. Полная аналитика — на странице{' '}
          <a href="/inventory/balances" className="text-brand-600 hover:underline">Остатки товаров</a>.
        </div>
      </Panel>

      {/* Детализация: ОС */}
      <Panel
        title={`Техника, мебель и т.п. — ${fmtCompact(a.fixedAssets)} ₸`}
        subtitle={
          data.fixedAssetsSource === 'sheet'
            ? `${data.fixedAssetsList.length} объектов · Google-таблица «Ведомость по ОС»`
            : data.fixedAssetsSource === 'manual'
              ? `${data.fixedAssetsList.length} объектов · ручной список, линейная амортизация`
              : 'Объекты ОС не загружены'
        }
      >
        {/* Сводка по типам — наглядная разбивка (мебель, техника, транспорт, ...) */}
        {data.fixedAssetsByType && data.fixedAssetsByType.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {data.fixedAssetsByType.map((g: any) => (
              <div key={g.type} className="bg-purple-50/50 border border-purple-100 rounded-lg p-2.5">
                <div className="text-[10px] text-purple-700 uppercase tracking-wider font-semibold">{g.type}</div>
                <div className="text-lg font-bold tabular-nums text-gray-900 mt-0.5">{fmtCompact(g.netBookValue)} ₸</div>
                <div className="text-[10px] text-gray-500">
                  {g.count} шт · перв. {fmtCompact(g.cost)} ₸
                </div>
              </div>
            ))}
          </div>
        )}

        <table className="report w-full text-sm">
          <thead>
            <tr>
              {data.fixedAssetsSource === 'sheet' && <th className="text-left">Тип</th>}
              <th className="text-left">Объект</th>
              {data.fixedAssetsSource === 'sheet' && <th className="text-left">Инв №</th>}
              {data.fixedAssetsSource === 'sheet' && <th className="text-left">Место</th>}
              {data.fixedAssetsSource === 'sheet' && <th className="text-left">Ответств.</th>}
              <th className="text-left">Введён</th>
              <th className="text-right">Срок, мес</th>
              <th className="text-right">Первонач.</th>
              <th className="text-right">Амортиз.</th>
              <th className="text-right">Остаточная</th>
            </tr>
          </thead>
          <tbody>
            {data.fixedAssetsList.map((f: any) => (
              <tr key={f.id} className="hover:bg-gray-50">
                {data.fixedAssetsSource === 'sheet' && <td className="text-xs text-gray-600">{f.type || '—'}</td>}
                <td className="font-medium">{f.name}</td>
                {data.fixedAssetsSource === 'sheet' && <td className="text-xs font-mono text-gray-500">{f.invNum || '—'}</td>}
                {data.fixedAssetsSource === 'sheet' && <td className="text-xs text-gray-600">{f.location || '—'}</td>}
                {data.fixedAssetsSource === 'sheet' && <td className="text-xs text-gray-600">{f.responsible || '—'}</td>}
                <td className="text-xs">{f.startDate ? new Date(f.startDate).toLocaleDateString('ru-RU') : '—'}</td>
                <td className="num text-xs">{f.usefulMonths}</td>
                <td className="num">{fmt(f.cost)}</td>
                <td className="num text-xs text-gray-500">{fmt(f.accumulatedDepreciation)}</td>
                <td className={'num font-semibold ' + (f.netBookValue <= 0 ? 'text-gray-400' : '')}>{fmt(f.netBookValue)}</td>
              </tr>
            ))}
            {data.fixedAssetsList.length === 0 && (
              <tr>
                <td colSpan={data.fixedAssetsSource === 'sheet' ? 10 : 6} className="text-center text-gray-400 py-4">
                  Объекты ОС не загружены — настройте интеграцию с Google-таблицей или добавьте вручную
                </td>
              </tr>
            )}
          </tbody>
          {data.fixedAssetsList.length > 0 && (
            <tfoot>
              <tr className="total">
                <td colSpan={data.fixedAssetsSource === 'sheet' ? 7 : 3}>Итого</td>
                <td className="num">{fmt(data.fixedAssetsList.reduce((s: number, f: any) => s + f.cost, 0))}</td>
                <td className="num">{fmt(data.fixedAssetsList.reduce((s: number, f: any) => s + f.accumulatedDepreciation, 0))}</td>
                <td className="num">{fmt(a.fixedAssets)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        <div className="text-[11px] text-gray-500 mt-2">
          {data.fixedAssetsSource === 'sheet'
            ? 'Источник: Google-таблица «Ведомость по ОС_Sut House», лист «Ведомость». Остаточная стоимость берётся из столбца месяца на выбранную дату.'
            : <>Управление ОС — на странице <a href="/settings/fixed-assets" className="text-brand-600 hover:underline">Основные средства</a>.</>}
        </div>
      </Panel>

      {/* Дебиторы и кредиторы */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Дебиторы (нам должны) — ${fmtCompact(a.receivables)} ₸`} subtitle="Топ 15">
          <table className="report w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Клиент</th>
                <th className="text-right">Долг ₸</th>
                <th className="text-right">Дней</th>
              </tr>
            </thead>
            <tbody>
              {data.topDebtors.map((d: any) => {
                const cls = d.oldestDays >= 30 ? 'text-rose-700' : d.oldestDays >= 14 ? 'text-amber-700' : 'text-gray-700';
                return (
                  <tr key={d.name} className="hover:bg-gray-50">
                    <td className="font-medium">{d.name}</td>
                    <td className="num font-semibold">{fmt(d.debt)}</td>
                    <td className={'num text-xs ' + cls}>{d.oldestDays}</td>
                  </tr>
                );
              })}
              {data.topDebtors.length === 0 && (
                <tr><td colSpan={3} className="text-center text-gray-400 py-4">Никто не должен</td></tr>
              )}
            </tbody>
          </table>
          <div className="text-[11px] text-gray-500 mt-2">
            Полный отчёт — на <a href="/receivables" className="text-brand-600 hover:underline">странице дебиторки</a>.
          </div>
        </Panel>
        <Panel title={`Кредиторы (мы должны) — ${fmtCompact(l.payables)} ₸`} subtitle="Топ 15">
          <table className="report w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Поставщик</th>
                <th className="text-right">Долг ₸</th>
                <th className="text-right">Дней</th>
              </tr>
            </thead>
            <tbody>
              {data.topCreditors.map((d: any) => {
                const cls = d.oldestDays >= 30 ? 'text-rose-700' : d.oldestDays >= 14 ? 'text-amber-700' : 'text-gray-700';
                return (
                  <tr key={d.name} className="hover:bg-gray-50">
                    <td className="font-medium">{d.name}</td>
                    <td className="num font-semibold">{fmt(d.debt)}</td>
                    <td className={'num text-xs ' + cls}>{d.oldestDays}</td>
                  </tr>
                );
              })}
              {data.topCreditors.length === 0 && (
                <tr><td colSpan={3} className="text-center text-gray-400 py-4">Мы никому не должны</td></tr>
              )}
            </tbody>
          </table>
          <div className="text-[11px] text-gray-500 mt-2">
            Полный отчёт — на <a href="/payables" className="text-brand-600 hover:underline">странице кредиторки</a>.
          </div>
        </Panel>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 Методика</div>
        <div className="space-y-1">
          <div><b>Деньги</b>: <code>OpeningBalance(kind=&apos;cash&apos;)</code> + движения по <code>DdsDocument</code> (с учётом перемещений между кассами).</div>
          <div><b>Товары</b>: <code>InventoryBalance.quantity</code> × последняя цена закупки.</div>
          <div><b>Дебиторка</b>: непогашенные реализации − платежи от клиентов (FIFO).</div>
          <div><b>Авансы поставщикам</b>: переплата нашим поставщикам (мы заплатили, но товара ещё нет).</div>
          <div><b>Основные средства</b>: <code>FixedAsset.cost</code> минус накопленная линейная амортизация на дату.</div>
          <div><b>Кредиторка</b>: непогашенные закупки − платежи поставщикам (FIFO).</div>
          <div><b>Авансы от клиентов</b>: переплата от клиентов (получили деньги, ещё не отгрузили).</div>
          <div><b>Капитал</b> = Активы − Пассивы. Это «то, что осталось бы нам после погашения всех долгов».</div>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, total, colorClass, children }: { title: string; total: number; colorClass: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-semibold text-gray-700 uppercase tracking-wider">{title}</div>
        <div className={'text-2xl font-bold tabular-nums ' + colorClass}>{fmt(total)} ₸</div>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function SegmentRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-0.5">
        <span className="text-gray-700">{label}</span>
        <span className="tabular-nums">
          <b>{fmt(value)} ₸</b>
          <span className="text-xs text-gray-400 ml-2">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
        </div>
      </div>
      <div className="p-4 overflow-auto">{children}</div>
    </div>
  );
}

function Kpi({ label, value, suffix, sub, color, bold }: any) {
  const cls =
    color === 'green' ? 'text-emerald-700' :
    color === 'amber' ? 'text-amber-700' :
    color === 'red' ? 'text-rose-700' :
    color === 'blue' ? 'text-blue-700' :
    'text-gray-900';
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

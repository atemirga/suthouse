'use client';

import { Fragment, useRef, useState } from 'react';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

type DayStatus = 'ok' | 'diff' | 'not_in_1c' | 'not_settled' | 'missing_in_statement';

interface DayRow {
  date: string;
  statementSales: number;
  oneCSum: number;
  diff: number;
  status: DayStatus;
  docs: { amount: number; who: string; number: string }[];
}
interface ReconResult {
  account: { number: string | null; holder: string | null; period: string | null };
  balances: { opening: number | null; closing: number | null };
  days: DayRow[];
  summary: {
    totalStatement: number; total1c: number; totalDiff: number;
    daysOk: number; daysDiff: number; daysNotSettled: number; daysMissing: number;
  };
  info: {
    fees: number; withdrawals: number; accountFees: number;
    refunds: number; commissionRefunds: number;
    other: { purpose: string; debit: number; credit: number }[];
  };
  meta: { fileName: string; statementRows: number };
}

const STATUS: Record<DayStatus, { label: string; cls: string }> = {
  ok: { label: 'ОК', cls: 'bg-emerald-50 text-emerald-700' },
  diff: { label: 'Расхождение', cls: 'bg-rose-50 text-rose-700' },
  not_in_1c: { label: 'Нет в 1С', cls: 'bg-rose-50 text-rose-700' },
  not_settled: { label: 'Ещё не засеттлено', cls: 'bg-amber-50 text-amber-700' },
  missing_in_statement: { label: 'Нет в выписке', cls: 'bg-rose-50 text-rose-700' },
};

const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y.slice(2)}`;
};

export default function VypiskaClient() {
  const [data, setData] = useState<ReconResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/vypiska/recon', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || d.error) setError(d.error || 'Ошибка обработки файла');
      else setData(d);
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить файл');
    } finally {
      setLoading(false);
    }
  }

  function toggle(day: string) {
    const next = new Set(expanded);
    if (next.has(day)) next.delete(day); else next.add(day);
    setExpanded(next);
  }

  function downloadCsv() {
    if (!data) return;
    const SEP = ';';
    const head = ['Дата', 'Продажи (выписка)', 'Оплаты 1С', 'Расхождение', 'Статус'];
    const lines = data.days.map((d) =>
      [fmtDay(d.date), d.statementSales, d.oneCSum, d.diff, STATUS[d.status].label].join(SEP),
    );
    const csv = '﻿' + [head.join(SEP), ...lines].join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sverka-${data.meta.fileName.replace(/\.[^.]+$/, '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const visibleDays = data
    ? (onlyProblems ? data.days.filter((d) => d.status !== 'ok') : data.days)
    : [];

  return (
    <div className="space-y-5">
      {/* Загрузка файла */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFile}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Загрузить выписку Kaspi
          </button>
          {fileName && <span className="text-sm text-gray-600 truncate">{fileName}</span>}
          {loading && <span className="text-xs text-gray-500">Обрабатываю…</span>}
          {data && (
            <button
              onClick={downloadCsv}
              className="ml-auto px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              Скачать CSV
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Excel/CSV выписки по расчётному счёту Kaspi. Сверяем дневные «Продажи с Kaspi.kz»
          с оплатами клиентов в 1С (счёт «Kaspi PAY»). Возвраты вычитаются из продаж дня.
        </p>
      </div>

      {error && (
        <div className="panel p-4 bg-rose-50 border-rose-200 text-rose-700 text-sm">{error}</div>
      )}

      {data && (
        <>
          {/* Шапка выписки */}
          <div className="text-xs text-gray-500 px-1">
            Счёт <b>{data.account.number ?? '—'}</b>
            {data.account.holder ? ` · ${data.account.holder}` : ''}
            {data.account.period ? ` · период ${data.account.period}` : ''}
            {data.balances.opening != null && (
              <> · вх. остаток <b>{fmt(data.balances.opening)} ₸</b></>
            )}
            {data.balances.closing != null && (
              <> · исх. остаток <b>{fmt(data.balances.closing)} ₸</b></>
            )}
          </div>

          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Продажи по выписке" value={fmt(data.summary.totalStatement) + ' ₸'} />
            <Kpi label="Оплаты в 1С" value={fmt(data.summary.total1c) + ' ₸'} />
            <Kpi
              label="Итоговое расхождение"
              value={fmt(data.summary.totalDiff) + ' ₸'}
              color={Math.abs(data.summary.totalDiff) < 1 ? 'green' : 'rose'}
            />
            <Kpi
              label="Дней с расхождением"
              value={String(data.summary.daysDiff + data.summary.daysMissing)}
              sub={`${data.summary.daysOk} ОК · ${data.summary.daysNotSettled} не засеттлено`}
              color={data.summary.daysDiff + data.summary.daysMissing > 0 ? 'rose' : 'green'}
            />
          </div>

          {/* Справочно: комиссии / выводы */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Комиссия процессинга" value={fmt(data.info.fees) + ' ₸'} color="gray" />
            <Kpi label="Выводы на Kaspi Gold" value={fmt(data.info.withdrawals) + ' ₸'} color="gray" />
            <Kpi label="Возвраты продаж" value={fmt(data.info.refunds) + ' ₸'} color="gray" />
            <Kpi label="Абонплата за счёт" value={fmt(data.info.accountFees) + ' ₸'} color="gray" />
          </div>

          {/* Таблица по дням */}
          <div className="panel">
            <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-gray-100">
              <div className="panel-title">Сверка по дням</div>
              <label className="text-xs text-gray-600 flex items-center gap-1.5 ml-auto cursor-pointer">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                Только расхождения
              </label>
              <span className="text-xs text-gray-500">Показано {visibleDays.length} из {data.days.length}</span>
            </div>
            <div className="overflow-auto">
              <table className="report w-full">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th className="text-right">Продажи (выписка)</th>
                    <th className="text-right">Оплаты 1С</th>
                    <th className="text-right">Δ</th>
                    <th>Статус</th>
                    <th className="text-right">1С док.</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDays.map((d) => {
                    const s = STATUS[d.status];
                    const open = expanded.has(d.date);
                    return (
                      <Fragment key={d.date}>
                        <tr
                          className={d.docs.length ? 'cursor-pointer' : ''}
                          onClick={() => d.docs.length && toggle(d.date)}
                        >
                          <td className="whitespace-nowrap">{fmtDay(d.date)}</td>
                          <td className="num">{d.statementSales ? fmt(d.statementSales) : '—'}</td>
                          <td className="num">{d.oneCSum ? fmt(d.oneCSum) : '—'}</td>
                          <td className={'num ' + (Math.abs(d.diff) >= 1 ? 'text-rose-600 font-semibold' : 'text-gray-400')}>
                            {d.diff ? fmt(d.diff) : '0'}
                          </td>
                          <td>
                            <span className={'inline-block px-2 py-0.5 rounded text-xs font-medium ' + s.cls}>
                              {s.label}
                            </span>
                          </td>
                          <td className="num text-gray-500">
                            {d.docs.length ? (open ? '▾ ' : '▸ ') + d.docs.length : '—'}
                          </td>
                        </tr>
                        {open && d.docs.length > 0 && (
                          <tr>
                            <td colSpan={6} className="bg-gray-50/60 !p-0">
                              <div className="px-4 py-2">
                                <table className="w-full text-xs">
                                  <tbody>
                                    {d.docs
                                      .slice()
                                      .sort((a, b) => b.amount - a.amount)
                                      .map((doc, i) => (
                                        <tr key={i} className="border-b border-gray-100 last:border-0">
                                          <td className="py-1 text-gray-600">{doc.who}</td>
                                          <td className="py-1 text-gray-400 w-24">{doc.number}</td>
                                          <td className="py-1 text-right tabular-nums w-32">{fmt(doc.amount)} ₸</td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-500 px-1">
            «Ещё не засеттлено» — оплаты есть в 1С, но Kaspi зачислит их на счёт на следующий день
            (за пределами этой выписки). «Расхождение» / «Нет в 1С» / «Нет в выписке» — требуют разбора.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: 'green' | 'rose' | 'gray' }) {
  const cls =
    color === 'green' ? 'text-emerald-700' :
    color === 'rose' ? 'text-rose-700' :
    color === 'gray' ? 'text-gray-600' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

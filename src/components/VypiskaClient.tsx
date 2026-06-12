'use client';

import { Fragment, useRef, useState } from 'react';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

type DayStatus = 'ok' | 'diff' | 'not_in_1c' | 'not_settled' | 'missing_in_statement';

interface DayRow {
  date: string; statementSales: number; oneCSum: number; diff: number;
  status: DayStatus; docs: { amount: number; who: string; number: string }[];
}
interface ReconResult {
  format: string;
  detectedBank: string;
  account: string;
  accountOptions: string[];
  meta: { fileName: string; holder: string | null; period: string | null; opening: number | null; closing: number | null; rows: number };
  days: DayRow[];
  summary: { totalStatement: number; total1c: number; totalDiff: number; daysOk: number; daysDiff: number; daysNotSettled: number; daysMissing: number };
  info: { incomingCount: number; outgoing: number; outgoingCount: number };
}

const STATUS: Record<DayStatus, { label: string; cls: string }> = {
  ok: { label: 'ОК', cls: 'bg-emerald-50 text-emerald-700' },
  diff: { label: 'Расхождение', cls: 'bg-rose-50 text-rose-700' },
  not_in_1c: { label: 'Нет в 1С', cls: 'bg-rose-50 text-rose-700' },
  not_settled: { label: 'Ещё не засеттлено', cls: 'bg-amber-50 text-amber-700' },
  missing_in_statement: { label: 'Нет в выписке', cls: 'bg-rose-50 text-rose-700' },
};
const FORMAT_LABEL: Record<string, string> = {
  'kaspi-pay': 'Kaspi Pay (расч. счёт)', 'kaspi-gold': 'Kaspi Gold (карта)',
  'halyk-pos': 'Halyk POS (эквайринг)', generic: 'универсальный',
};
const fmtDay = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}.${m}.${y.slice(2)}`; };

export default function VypiskaClient() {
  const [data, setData] = useState<ReconResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null); // храним файл, чтобы переслать при смене счёта

  async function upload(file: File, account?: string) {
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (account) fd.append('account', account);
      const r = await fetch('/api/vypiska/recon', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || d.error) { setError(d.error || 'Ошибка обработки файла'); setData(null); }
      else setData(d);
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить файл'); setData(null);
    } finally { setLoading(false); }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    fileRef.current = file; setFileName(file.name); setData(null); setExpanded(new Set());
    upload(file);
  }
  function onAccountChange(account: string) {
    if (fileRef.current) upload(fileRef.current, account);
  }
  function toggle(day: string) { const n = new Set(expanded); n.has(day) ? n.delete(day) : n.add(day); setExpanded(n); }

  function downloadCsv() {
    if (!data) return;
    const head = ['Дата', 'Поступления (выписка)', 'Оплаты 1С', 'Расхождение', 'Статус'];
    const lines = data.days.map((d) => [fmtDay(d.date), d.statementSales, d.oneCSum, d.diff, STATUS[d.status].label].join(';'));
    const csv = '﻿' + [head.join(';'), ...lines].join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `sverka-${data.meta.fileName.replace(/\.[^.]+$/, '')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const visibleDays = data ? (onlyProblems ? data.days.filter((d) => d.status !== 'ok') : data.days) : [];

  return (
    <div className="space-y-5">
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={onFile} className="hidden" />
          <button onClick={() => inputRef.current?.click()} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
            Загрузить выписку
          </button>
          {fileName && <span className="text-sm text-gray-600 truncate max-w-[280px]">{fileName}</span>}
          {loading && <span className="text-xs text-gray-500">Обрабатываю…</span>}
          {data && <button onClick={downloadCsv} className="ml-auto px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Скачать CSV</button>}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Любая выписка: Excel/CSV или PDF (Kaspi Pay, Kaspi Gold, Halyk POS и др.). Формат и
          поступления определяются автоматически; счёт 1С для сверки можно поменять справа.
        </p>
      </div>

      {error && <div className="panel p-4 bg-rose-50 border-rose-200 text-rose-700 text-sm">{error}</div>}

      {data && (
        <>
          {/* Детект + выбор счёта */}
          <div className="panel p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div><span className="text-gray-500">Формат:</span> <b>{FORMAT_LABEL[data.format] || data.format}</b> ({data.detectedBank})</div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Сверять со счётом 1С:</span>
              <select value={data.account} onChange={(e) => onAccountChange(e.target.value)} disabled={loading}
                className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white">
                {data.accountOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="text-xs text-gray-500">
              распознано поступлений: <b>{data.info.incomingCount}</b>{data.info.outgoingCount ? ` · списаний: ${data.info.outgoingCount} (${fmt(data.info.outgoing)} ₸)` : ''}
            </div>
          </div>

          <div className="text-xs text-gray-500 px-1">
            {data.meta.holder ? `${data.meta.holder} · ` : ''}{data.meta.period ? `период ${data.meta.period}` : ''}
            {data.meta.opening != null && <> · вх. остаток <b>{fmt(data.meta.opening)} ₸</b></>}
            {data.meta.closing != null && <> · исх. остаток <b>{fmt(data.meta.closing)} ₸</b></>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Поступления по выписке" value={fmt(data.summary.totalStatement) + ' ₸'} />
            <Kpi label="Оплаты в 1С" value={fmt(data.summary.total1c) + ' ₸'} />
            <Kpi label="Итоговое расхождение" value={fmt(data.summary.totalDiff) + ' ₸'} color={Math.abs(data.summary.totalDiff) < 1 ? 'green' : 'rose'} />
            <Kpi label="Дней с расхождением" value={String(data.summary.daysDiff + data.summary.daysMissing)}
              sub={`${data.summary.daysOk} ОК · ${data.summary.daysNotSettled} не засеттлено`}
              color={data.summary.daysDiff + data.summary.daysMissing > 0 ? 'rose' : 'green'} />
          </div>

          <div className="panel">
            <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-gray-100">
              <div className="panel-title">Сверка по дням</div>
              <label className="text-xs text-gray-600 flex items-center gap-1.5 ml-auto cursor-pointer">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Только расхождения
              </label>
              <span className="text-xs text-gray-500">Показано {visibleDays.length} из {data.days.length}</span>
            </div>
            <div className="overflow-auto">
              <table className="report w-full">
                <thead><tr>
                  <th>Дата</th><th className="text-right">Поступления (выписка)</th><th className="text-right">Оплаты 1С</th>
                  <th className="text-right">Δ</th><th>Статус</th><th className="text-right">1С док.</th>
                </tr></thead>
                <tbody>
                  {visibleDays.map((d) => {
                    const s = STATUS[d.status]; const open = expanded.has(d.date);
                    return (
                      <Fragment key={d.date}>
                        <tr className={d.docs.length ? 'cursor-pointer' : ''} onClick={() => d.docs.length && toggle(d.date)}>
                          <td className="whitespace-nowrap">{fmtDay(d.date)}</td>
                          <td className="num">{d.statementSales ? fmt(d.statementSales) : '—'}</td>
                          <td className="num">{d.oneCSum ? fmt(d.oneCSum) : '—'}</td>
                          <td className={'num ' + (Math.abs(d.diff) >= 1 ? 'text-rose-600 font-semibold' : 'text-gray-400')}>{d.diff ? fmt(d.diff) : '0'}</td>
                          <td><span className={'inline-block px-2 py-0.5 rounded text-xs font-medium ' + s.cls}>{s.label}</span></td>
                          <td className="num text-gray-500">{d.docs.length ? (open ? '▾ ' : '▸ ') + d.docs.length : '—'}</td>
                        </tr>
                        {open && d.docs.length > 0 && (
                          <tr><td colSpan={6} className="bg-gray-50/60 !p-0">
                            <div className="px-4 py-2"><table className="w-full text-xs"><tbody>
                              {d.docs.slice().sort((a, b) => b.amount - a.amount).map((doc, i) => (
                                <tr key={i} className="border-b border-gray-100 last:border-0">
                                  <td className="py-1 text-gray-600">{doc.who}</td>
                                  <td className="py-1 text-gray-400 w-24">{doc.number}</td>
                                  <td className="py-1 text-right tabular-nums w-32">{fmt(doc.amount)} ₸</td>
                                </tr>
                              ))}
                            </tbody></table></div>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-500 px-1">
            «Ещё не засеттлено» — поступления есть в 1С, но банк зачислит их позже (вне выписки).
            «Расхождение» / «Нет в 1С» / «Нет в выписке» — требуют разбора. Если 1С пусто по всем
            дням — проверьте, что выбран правильный счёт 1С.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: 'green' | 'rose' | 'gray' }) {
  const cls = color === 'green' ? 'text-emerald-700' : color === 'rose' ? 'text-rose-700' : color === 'gray' ? 'text-gray-600' : 'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { OpiuReport } from '@/lib/reports/opiu';
import { format } from 'date-fns';

function fmt(n: number, isPct?: boolean) {
  if (isPct) return (n * 100).toFixed(1) + '%';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

interface DocRow {
  id: string;
  date: string;
  number: string;
  counterparty?: string | null;
  article?: string | null;
  amount: number;
  comment?: string | null;
}

export default function OpiuTable({ report }: { report: OpiuReport }) {
  const [drill, setDrill] = useState<{ category: string; label: string; docs: DocRow[] } | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  async function openDrill(category: string, label: string) {
    setDrillLoading(true);
    setDrill({ category, label, docs: [] });
    try {
      const params = new URLSearchParams({
        from: format(new Date(report.from), 'yyyy-MM-dd'),
        to: format(new Date(report.to), 'yyyy-MM-dd'),
        drill: category,
      });
      const r = await fetch('/api/opiu?' + params.toString());
      const data = await r.json();
      setDrill({ category, label, docs: data.docs || [] });
    } finally {
      setDrillLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="sticky left-0 bg-gray-50 z-10">Показатель</th>
              {report.columns.map((c) => (
                <th key={c} className="text-right">{c}</th>
              ))}
              <th className="text-right">Итого</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              const cls = row.kind === 'header'
                ? 'subtotal'
                : row.kind === 'sum'
                  ? 'subtotal'
                  : row.id === 'net_profit'
                    ? 'total'
                    : '';
              const labelStyle: any = { paddingLeft: 12 + row.level * 16 };
              const canDrill = !!row.drilldownCategory;
              return (
                <tr key={row.id} className={cls}>
                  <td className="sticky left-0 bg-white z-10" style={labelStyle}>
                    {canDrill ? (
                      <button
                        onClick={() => openDrill(row.drilldownCategory!, row.label)}
                        className="text-left hover:underline text-brand-700"
                      >
                        {row.label}
                      </button>
                    ) : (
                      row.label
                    )}
                  </td>
                  {report.columns.map((c) => (
                    <td key={c} className="num">
                      {row.kind === 'header' ? '' : fmt(row.values[c] || 0, row.isPct)}
                    </td>
                  ))}
                  <td className="num">
                    {row.kind === 'header' ? '' : fmt(row.total || 0, row.isPct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drill && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDrill(null)}>
          <div className="bg-white rounded-lg max-w-5xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold">{drill.label} — документы</h3>
              <button onClick={() => setDrill(null)} className="text-gray-400 hover:text-gray-700">×</button>
            </div>
            <div className="p-4">
              {drillLoading ? (
                <div className="text-sm text-gray-500">Загрузка…</div>
              ) : drill.docs.length === 0 ? (
                <div className="text-sm text-gray-500">Нет документов</div>
              ) : (
                <table className="report">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>№</th>
                      <th>Контрагент</th>
                      {drill.docs.some((d) => d.article) && <th>Статья</th>}
                      <th className="text-right">Сумма</th>
                      <th>Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.docs.map((d) => (
                      <tr key={d.id}>
                        <td>{format(new Date(d.date), 'dd.MM.yyyy')}</td>
                        <td className="text-xs">{d.number}</td>
                        <td>{d.counterparty || '—'}</td>
                        {drill.docs.some((d) => d.article) && <td>{d.article || '—'}</td>}
                        <td className="num">{fmt(d.amount)}</td>
                        <td className="text-xs text-gray-500 max-w-md truncate">{d.comment || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

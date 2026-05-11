'use client';

import type { DdsReport } from '@/lib/reports/dds';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

const SECTION_LABELS: Record<string, string> = {
  operating: 'Операционная деятельность',
  investing: 'Инвестиционная деятельность',
  financing: 'Финансовая деятельность',
};

export default function DdsTable({ report }: { report: DdsReport }) {
  const sections: Array<'operating' | 'investing' | 'financing'> = ['operating', 'investing', 'financing'];
  const rowsBySection: Record<string, typeof report.rows> = {};
  for (const s of sections) rowsBySection[s] = [];
  for (const r of report.rows) {
    const s = (r.section in rowsBySection ? r.section : 'operating') as 'operating' | 'investing' | 'financing';
    rowsBySection[s].push(r);
  }

  function totalForSection(section: string, col: string, key: 'in' | 'out'): number {
    const t = report.totals[col];
    if (!t) return 0;
    if (section === 'operating') return key === 'in' ? t.inflowOperating : t.outflowOperating;
    if (section === 'investing') return key === 'in' ? t.inflowInvesting : t.outflowInvesting;
    if (section === 'financing') return key === 'in' ? t.inflowFinancing : t.outflowFinancing;
    return 0;
  }
  function netForSection(section: string, col: string): number {
    const t = report.totals[col];
    if (!t) return 0;
    if (section === 'operating') return t.netOperating;
    if (section === 'investing') return t.netInvesting;
    if (section === 'financing') return t.netFinancing;
    return 0;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-auto">
      <table className="report">
        <thead>
          <tr>
            <th className="sticky left-0 bg-gray-50 z-10 min-w-[260px]">Статья</th>
            {report.columns.map((c) => (
              <th key={c} className="text-right">{c}</th>
            ))}
            <th className="text-right">Итого</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => {
            const inRows = rowsBySection[section].filter((r) => r.direction === 'inflow');
            const outRows = rowsBySection[section].filter((r) => r.direction === 'outflow');
            return (
              <>
                <tr key={`${section}-h`} className="subtotal">
                  <td colSpan={report.columns.length + 2} className="sticky left-0 bg-gray-50 z-10 font-semibold">
                    {SECTION_LABELS[section]}
                  </td>
                </tr>
                {inRows.length > 0 && (
                  <tr className="text-xs text-green-700">
                    <td className="sticky left-0 bg-white z-10 pl-6">Поступления</td>
                    {report.columns.map((c) => <td key={c} />)}
                    <td />
                  </tr>
                )}
                {inRows.map((r) => (
                  <tr key={`${section}-in-${r.articleId || 'none'}`}>
                    <td className="sticky left-0 bg-white z-10 pl-10 text-green-800">{r.articleName}</td>
                    {report.columns.map((c) => (
                      <td key={c} className="num">{r.values[c] ? '+' + fmt(r.values[c]) : ''}</td>
                    ))}
                    <td className="num">{r.total ? '+' + fmt(r.total) : ''}</td>
                  </tr>
                ))}
                {outRows.length > 0 && (
                  <tr className="text-xs text-red-700">
                    <td className="sticky left-0 bg-white z-10 pl-6">Списания</td>
                    {report.columns.map((c) => <td key={c} />)}
                    <td />
                  </tr>
                )}
                {outRows.map((r) => (
                  <tr key={`${section}-out-${r.articleId || 'none'}`}>
                    <td className="sticky left-0 bg-white z-10 pl-10 text-red-800">{r.articleName}</td>
                    {report.columns.map((c) => (
                      <td key={c} className="num">{r.values[c] ? '−' + fmt(r.values[c]) : ''}</td>
                    ))}
                    <td className="num">{r.total ? '−' + fmt(r.total) : ''}</td>
                  </tr>
                ))}
                <tr key={`${section}-net`} className="subtotal">
                  <td className="sticky left-0 bg-gray-50 z-10 pl-6">Чистый поток · {SECTION_LABELS[section].toLowerCase()}</td>
                  {report.columns.map((c) => (
                    <td key={c} className="num">{fmt(netForSection(section, c))}</td>
                  ))}
                  <td className="num">{fmt(
                    section === 'operating' ? report.grandTotal.netOperating
                    : section === 'investing' ? report.grandTotal.netInvesting
                    : report.grandTotal.netFinancing
                  )}</td>
                </tr>
              </>
            );
          })}
          <tr className="total">
            <td className="sticky left-0 z-10">Чистый денежный поток</td>
            {report.columns.map((c) => (
              <td key={c} className="num">{fmt(report.totals[c]?.netFlow || 0)}</td>
            ))}
            <td className="num">{fmt(report.grandTotal.netFlow)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

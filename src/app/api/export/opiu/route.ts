import { NextRequest } from 'next/server';
import { buildOpiu } from '@/lib/reports/opiu';
import { startOfMonth, endOfMonth, parseISO, format } from 'date-fns';
import { toCsv, csvResponse } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ? parseISO(url.searchParams.get('from')!) : startOfMonth(new Date());
  const to = url.searchParams.get('to') ? parseISO(url.searchParams.get('to')!) : endOfMonth(new Date());
  const granularity = (url.searchParams.get('granularity') as any) || 'month';

  const r = await buildOpiu({ from, to, granularity });

  const headers = ['Показатель', ...r.columns, 'Итого'];
  const rows = r.rows.map((row) => [
    row.label,
    ...r.columns.map((c) => row.kind === 'header' ? '' : (row.isPct ? (row.values[c] * 100).toFixed(1) + '%' : Math.round(row.values[c] || 0))),
    row.kind === 'header' ? '' : (row.isPct ? (row.total * 100).toFixed(1) + '%' : Math.round(row.total || 0)),
  ]);

  const filename = `OPiU_${format(from, 'yyyyMMdd')}_${format(to, 'yyyyMMdd')}.csv`;
  return csvResponse(filename, toCsv(headers, rows));
}

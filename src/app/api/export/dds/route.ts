import { NextRequest } from 'next/server';
import { buildDds } from '@/lib/reports/dds';
import { startOfMonth, endOfMonth, parseISO, format } from 'date-fns';
import { toCsv, csvResponse } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from') ? parseISO(url.searchParams.get('from')!) : startOfMonth(new Date());
  const to = url.searchParams.get('to') ? parseISO(url.searchParams.get('to')!) : endOfMonth(new Date());
  const granularity = (url.searchParams.get('granularity') as any) || 'month';

  const r = await buildDds({
    from, to, granularity,
    kassaIds: url.searchParams.get('kassa')?.split(',').filter(Boolean),
    accountIds: url.searchParams.get('account')?.split(',').filter(Boolean),
    articleIds: url.searchParams.get('article')?.split(',').filter(Boolean),
    kontragentIds: url.searchParams.get('kontragent')?.split(',').filter(Boolean),
    search: url.searchParams.get('q') || undefined,
  });

  const headers = ['Раздел', 'Направление', 'Статья', ...r.columns, 'Итого'];
  const rows = r.rows.map((row) => [
    row.section,
    row.direction === 'inflow' ? 'Поступление' : 'Списание',
    row.articleName,
    ...r.columns.map((c) => Math.round(row.values[c] || 0)),
    Math.round(row.total || 0),
  ]);

  const filename = `DDS_${format(from, 'yyyyMMdd')}_${format(to, 'yyyyMMdd')}.csv`;
  return csvResponse(filename, toCsv(headers, rows));
}

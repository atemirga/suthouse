import { NextRequest, NextResponse } from 'next/server';
import { buildDds } from '@/lib/reports/dds';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function listParam(url: URL, name: string): string[] | undefined {
  const v = url.searchParams.get(name);
  if (!v) return undefined;
  return v.split(',').filter(Boolean);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const granularity = (url.searchParams.get('granularity') as 'day' | 'week' | 'month') || 'month';

  const from = fromStr ? parseISO(fromStr) : startOfMonth(new Date());
  const to = toStr ? parseISO(toStr) : endOfMonth(new Date());

  const report = await buildDds({
    from,
    to,
    granularity,
    kassaIds: listParam(url, 'kassa'),
    accountIds: listParam(url, 'account'),
    articleIds: listParam(url, 'article'),
    kontragentIds: listParam(url, 'kontragent'),
    search: url.searchParams.get('q') || undefined,
  });
  return NextResponse.json(report);
}

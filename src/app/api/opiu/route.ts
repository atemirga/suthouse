import { NextRequest, NextResponse } from 'next/server';
import { buildOpiu, drillOpiu, type OpiuCategory } from '@/lib/reports/opiu';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const granularity = (url.searchParams.get('granularity') as 'day' | 'week' | 'month') || 'month';
  const drillCategory = url.searchParams.get('drill') as OpiuCategory | null;

  const from = fromStr ? parseISO(fromStr) : startOfMonth(new Date());
  const to = toStr ? parseISO(toStr) : endOfMonth(new Date());

  if (drillCategory) {
    const docs = await drillOpiu(drillCategory, from, to);
    return NextResponse.json({ category: drillCategory, docs });
  }

  const report = await buildOpiu({ from, to, granularity });
  return NextResponse.json(report);
}

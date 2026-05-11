import { NextRequest, NextResponse } from 'next/server';
import { buildDashboard } from '@/lib/reports/dashboard';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const granularity = (url.searchParams.get('granularity') as 'day' | 'week' | 'month') || 'month';
  const from = fromStr ? parseISO(fromStr) : startOfMonth(new Date());
  const to = toStr ? parseISO(toStr) : endOfMonth(new Date());

  const data = await buildDashboard({ from, to, granularity });
  return NextResponse.json(data);
}

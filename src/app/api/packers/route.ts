import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth } from 'date-fns';
import { buildPackersReport } from '@/lib/reports/packers';
import { parsePeriodFrom, parsePeriodTo } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from') ? parsePeriodFrom(sp.get('from')!) : startOfMonth(new Date());
  const to = sp.get('to') ? parsePeriodTo(sp.get('to')!) : endOfMonth(new Date());
  const report = await buildPackersReport({ from, to });
  return NextResponse.json({
    ...report,
    from: report.from.toISOString(),
    to: report.to.toISOString(),
  });
}

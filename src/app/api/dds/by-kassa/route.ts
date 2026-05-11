import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildDdsByKassa } from '@/lib/reports/dds-by-kassa';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const from = sp.get('from') ? parseISO(sp.get('from')!) : startOfMonth(new Date());
    const to = sp.get('to') ? parseISO(sp.get('to')!) : endOfMonth(new Date());
    const report = await buildDdsByKassa({ from, to });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

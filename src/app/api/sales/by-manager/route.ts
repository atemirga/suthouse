import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildOrdersByManager } from '@/lib/reports/orders-by-manager';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const from = sp.get('from') ? parseISO(sp.get('from')!) : startOfMonth(new Date());
    const to = sp.get('to') ? parseISO(sp.get('to')!) : endOfMonth(new Date());
    const report = await buildOrdersByManager({ from, to });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

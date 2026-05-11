import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildAbc, type AbcParam } from '@/lib/reports/abc';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const from = sp.get('from') ? parseISO(sp.get('from')!) : startOfMonth(new Date());
    const to = sp.get('to') ? parseISO(sp.get('to')!) : endOfMonth(new Date());
    const param = (sp.get('param') as AbcParam) || 'revenue';
    const report = await buildAbc({ from, to, param });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

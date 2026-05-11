import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { buildPayments } from '@/lib/reports/payments';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const from = sp.get('from') ? parseISO(sp.get('from')!) : startOfMonth(new Date());
    const to = sp.get('to') ? parseISO(sp.get('to')!) : endOfMonth(new Date());
    const report = await buildPayments({
      from, to,
      direction: (sp.get('direction') as any) || 'all',
      kassaId: sp.get('kassaId') || undefined,
      accountId: sp.get('accountId') || undefined,
      kontragentId: sp.get('kontragentId') || undefined,
      search: sp.get('q') || undefined,
      limit: sp.get('limit') ? Number(sp.get('limit')) : 500,
    });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

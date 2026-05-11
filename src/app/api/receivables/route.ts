import { NextRequest, NextResponse } from 'next/server';
import { buildReceivables } from '@/lib/reports/receivables';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asOfStr = sp.get('asOf');
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 0;
  const minDebt = sp.get('minDebt') ? Number(sp.get('minDebt')) : 1;

  try {
    const report = await buildReceivables({
      asOf: asOfStr ? new Date(asOfStr) : undefined,
      limit: isFinite(limit) ? limit : 0,
      minDebt: isFinite(minDebt) ? minDebt : 1,
    });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

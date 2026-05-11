import { NextRequest, NextResponse } from 'next/server';
import { buildPayables } from '@/lib/reports/payables';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const asOf = sp.get('asOf') ? new Date(sp.get('asOf')!) : undefined;
    const report = await buildPayables({ asOf });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

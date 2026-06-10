import { NextRequest, NextResponse } from 'next/server';
import { parseISO } from 'date-fns';
import { buildBalance } from '@/lib/reports/balance';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const asOf = sp.get('asOf') ? parseISO(sp.get('asOf')!) : undefined;
    const report = await buildBalance({ asOf });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

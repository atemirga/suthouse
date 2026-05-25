import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import { buildSalesBySku, drillSku } from '@/lib/reports/sales-by-sku';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const from = sp.get('from') ? startOfDay(parseISO(sp.get('from')!)) : startOfMonth(new Date());
    const to = sp.get('to') ? endOfDay(parseISO(sp.get('to')!)) : endOfMonth(new Date());
    const drill = sp.get('drill');
    if (drill) {
      const detail = await drillSku(drill, from, to);
      return NextResponse.json({ drill, items: detail });
    }
    const limit = sp.get('limit') ? Number(sp.get('limit')) : 300;
    const managerFilter = sp.get('manager') || null;
    const report = await buildSalesBySku({ from, to, limit, managerFilter });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

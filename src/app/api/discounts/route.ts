import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import { buildDiscounts, drillDiscounts } from '@/lib/reports/discounts';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const from = sp.get('from') ? startOfDay(parseISO(sp.get('from')!)) : startOfMonth(new Date());
    const to = sp.get('to') ? endOfDay(parseISO(sp.get('to')!)) : endOfMonth(new Date());

    // Drill-down: ?drill=contractor&id=<kontragentId>
    //             ?drill=item&id=<nomenclatureId>  (или &name=<...>)
    //             ?drill=manager&name=<responsibleName>
    const drill = sp.get('drill');
    if (drill) {
      const id = sp.get('id');
      const name = sp.get('name');
      const docs = await drillDiscounts({
        from, to,
        kontragentId: drill === 'contractor' ? id : null,
        nomenclatureId: drill === 'item' ? id : null,
        nomenclatureName: drill === 'item' && !id ? name : null,
        manager: drill === 'manager' ? name : null,
      });
      return NextResponse.json({ drill, id, name, docs });
    }

    const report = await buildDiscounts({ from, to });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

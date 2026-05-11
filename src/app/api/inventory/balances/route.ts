import { NextRequest, NextResponse } from 'next/server';
import { buildInventory } from '@/lib/reports/inventory';
import { syncInventoryBalances } from '@/lib/sync/inventory-balances';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const report = await buildInventory({ warehouseId: sp.get('warehouseId') || undefined });
    return NextResponse.json(report);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// POST = пересинхронизация остатков на сейчас (ручной триггер из UI).
export async function POST() {
  try {
    const r = await syncInventoryBalances();
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { recomputeFifoCosts } from '@/lib/sync/fifo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/sync/fifo — пересчитать себестоимость реализаций по FIFO.
// Использует уже синхронизированные Zakupka + Realizacia, OData не дёргает.
export async function POST() {
  try {
    const stats = await recomputeFifoCosts();
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

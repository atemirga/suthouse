import { NextResponse } from 'next/server';
import { buildPlanFact } from '@/lib/reports/plan-fact';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const r = await buildPlanFact();
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

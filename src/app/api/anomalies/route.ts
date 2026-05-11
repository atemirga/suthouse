import { NextResponse } from 'next/server';
import { buildAnomalies } from '@/lib/reports/anomalies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const r = await buildAnomalies();
  return NextResponse.json(r);
}

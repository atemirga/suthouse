import { NextRequest, NextResponse } from 'next/server';
import { buildRnp } from '@/lib/reports/rnp';
import { parseISO } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const responsible = url.searchParams.get('responsible') || undefined;
  const kontragentId = url.searchParams.get('kontragent') || undefined;
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');

  const report = await buildRnp({
    status,
    responsible,
    kontragentId,
    from: fromStr ? parseISO(fromStr) : undefined,
    to: toStr ? parseISO(toStr) : undefined,
  });
  return NextResponse.json(report);
}

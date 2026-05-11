import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { parseISO } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await prisma.fixedAsset.findMany({ orderBy: { startDate: 'desc' } });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, cost, usefulMonths, startDate, method } = body || {};
  if (!name || !cost || !usefulMonths || !startDate) {
    return NextResponse.json({ error: 'name, cost, usefulMonths, startDate required' }, { status: 400 });
  }
  const fa = await prisma.fixedAsset.create({
    data: {
      name,
      cost: Number(cost),
      usefulMonths: Number(usefulMonths),
      startDate: parseISO(startDate),
      method: method || 'linear',
    },
  });
  return NextResponse.json(fa);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.fixedAsset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await prisma.manualAdjustment.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { month, category, amount, comment } = body || {};
  if (!month || !category || amount === undefined) {
    return NextResponse.json({ error: 'month, category, amount required' }, { status: 400 });
  }
  const a = await prisma.manualAdjustment.create({
    data: { month, category, amount: Number(amount), comment: comment || null },
  });
  return NextResponse.json(a);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.manualAdjustment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

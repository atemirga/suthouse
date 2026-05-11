import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const plans = await prisma.salesPlan.findMany({ orderBy: { startDate: 'desc' } });
  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const created = await prisma.salesPlan.create({
      data: {
        scenarioName: String(body.scenarioName || 'Основной'),
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        scope: String(body.scope || 'total'),
        scopeId: body.scopeId || null,
        scopeName: body.scopeName || null,
        amountPlan: Number(body.amountPlan || 0),
        quantityPlan: Number(body.quantityPlan || 0),
        responsible: body.responsible || null,
        comment: body.comment || null,
      },
    });
    return NextResponse.json(created);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    await prisma.salesPlan.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 404 });
  }
}

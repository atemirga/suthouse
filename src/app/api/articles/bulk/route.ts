import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /api/articles/bulk — массовое назначение категории/раздела.
// body: { ids: string[], opiuCategory?: string|null, ddsSection?: string }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { ids, opiuCategory, ddsSection } = body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 });
  }
  const data: any = {};
  if (opiuCategory !== undefined) data.opiuCategory = opiuCategory || null;
  if (ddsSection !== undefined) data.ddsSection = ddsSection || null;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }
  const r = await prisma.ddsArticle.updateMany({
    where: { id: { in: ids } },
    data,
  });
  return NextResponse.json({ ok: true, updated: r.count });
}

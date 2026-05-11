import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const articles = await prisma.ddsArticle.findMany({
    orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
  });
  return NextResponse.json(articles);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, opiuCategory, ddsSection } = body || {};
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const updated = await prisma.ddsArticle.update({
    where: { id },
    data: {
      ...(opiuCategory !== undefined ? { opiuCategory: opiuCategory || null } : {}),
      ...(ddsSection !== undefined ? { ddsSection: ddsSection || null } : {}),
    },
  });
  return NextResponse.json(updated);
}

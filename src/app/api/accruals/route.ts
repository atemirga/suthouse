import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const rules = await prisma.accrualRule.findMany({ orderBy: { createdAt: 'desc' } });
  const articles = await prisma.ddsArticle.findMany({
    where: { id: { in: rules.map((r) => r.articleId) } },
    select: { id: true, name: true },
  });
  const map = new Map(articles.map((a) => [a.id, a.name]));
  return NextResponse.json(rules.map((r) => ({ ...r, articleName: map.get(r.articleId) })));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { articleId, months, method } = body || {};
  if (!articleId || !months) return NextResponse.json({ error: 'articleId and months required' }, { status: 400 });
  const r = await prisma.accrualRule.upsert({
    where: { articleId },
    create: { articleId, months: Number(months), method: method || 'equal' },
    update: { months: Number(months), method: method || 'equal' },
  });
  return NextResponse.json(r);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.accrualRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

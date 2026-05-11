import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { autoMapArticle } from '@/lib/sync/catalogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/articles/automap — применить автомаппинг ко всем статьям с пустой opiuCategory.
// Уже размеченные пользователем не трогаются.
export async function POST() {
  const empties = await prisma.ddsArticle.findMany({
    where: { isFolder: false, opiuCategory: null },
    select: { id: true, name: true },
  });
  let updated = 0;
  for (const a of empties) {
    const m = autoMapArticle(a.name);
    if (!m.opiu) continue;
    await prisma.ddsArticle.update({
      where: { id: a.id },
      data: { opiuCategory: m.opiu, ddsSection: m.section },
    });
    updated++;
  }
  return NextResponse.json({ ok: true, total: empties.length, updated, leftUnmapped: empties.length - updated });
}

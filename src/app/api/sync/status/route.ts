import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [logs, counts] = await Promise.all([
    prisma.syncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
    Promise.all([
      prisma.kontragent.count(),
      prisma.ddsArticle.count(),
      prisma.nomenclature.count(),
      prisma.kassa.count(),
      prisma.bankAccount.count(),
      prisma.user1C.count(),
      prisma.ddsDocument.count(),
      prisma.realizacia.count(),
      prisma.zakupka.count(),
      prisma.orderBuyer.count(),
      prisma.writeOff.count(),
      prisma.capitalization.count(),
    ]),
  ]);
  const [kontragenty, articles, nomenclature, kassy, banks, users, dds, realizacii, zakupki, orders, writeOffs, capitalizations] = counts;
  return NextResponse.json({
    counts: { kontragenty, articles, nomenclature, kassy, banks, users, dds, realizacii, zakupki, orders, writeOffs, capitalizations },
    logs,
  });
}

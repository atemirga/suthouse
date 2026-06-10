import { NextRequest, NextResponse } from 'next/server';
import { buildDashboard } from '@/lib/reports/dashboard';
import { prisma } from '@/lib/db';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const granularity = (url.searchParams.get('granularity') as 'day' | 'week' | 'month') || 'month';
  const from = fromStr ? startOfDay(parseISO(fromStr)) : startOfMonth(new Date());
  const to = toStr ? endOfDay(parseISO(toStr)) : endOfMonth(new Date());

  const [data, lastSync, unmappedCount] = await Promise.all([
    buildDashboard({ from, to, granularity }),
    prisma.syncLog.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.ddsArticle.count({ where: { opiuCategory: null, isFolder: false } }),
  ]);

  return NextResponse.json({
    ...data,
    lastSync: lastSync
      ? {
          status: lastSync.status,
          finishedAt: lastSync.finishedAt?.toISOString() || null,
          startedAt: lastSync.startedAt.toISOString(),
        }
      : null,
    unmappedCount,
    fetchedAt: new Date().toISOString(),
  });
}

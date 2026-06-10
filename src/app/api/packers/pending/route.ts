import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth } from 'date-fns';
import { prisma } from '@/lib/db';
import { parsePeriodFrom, parsePeriodTo } from '@/lib/dates';
import { statusBucket } from '@/lib/reports/packers';

export const dynamic = 'force-dynamic';

// Возвращает заказы конкретного упаковщика по СостояниюЗаказа из 1С.
//
// Согласовано с totals.workingCount/problemCount из buildPackersReport
// (src/lib/reports/packers.ts): счёт идёт по statusBucket, без фильтра «не
// сматчен с Realizacia». На практике inProgress-состояния почти не пересекаются
// с матчингом, но для согласованности счётчиков это важно.
//
// ?bucket=working|problem|all — какие возвращать. Default = working.
//   working = working + otk + otk_manager + waiting (все «в процессе»)
//   problem = problem
//   all     = всё, что НЕ done и НЕ unknown (для отладки)

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const packer = sp.get('packer');
  if (!packer) return NextResponse.json({ error: 'packer required' }, { status: 400 });

  const bucketParam = sp.get('bucket') as 'working' | 'problem' | 'all' | null;
  const bucket: 'working' | 'problem' | 'all' = bucketParam || 'working';

  const from = sp.get('from') ? parsePeriodFrom(sp.get('from')!) : startOfMonth(new Date());
  const to = sp.get('to') ? parsePeriodTo(sp.get('to')!) : endOfMonth(new Date());

  const isUnassigned = packer === '— без упаковщика —';
  const IN_PROGRESS = new Set(['working', 'otk', 'otk_manager', 'waiting']);

  const allOrders = await prisma.orderBuyer.findMany({
    where: { posted: true, date: { gte: from, lte: to } },
    select: {
      id: true, number: true, date: true, shipmentDate: true,
      kontragentId: true, kontragentName: true, totalAmount: true,
      packerName: true, stateName: true,
    },
  });

  const pending = allOrders
    .filter((o) => (isUnassigned ? !o.packerName : o.packerName === packer))
    .filter((o) => {
      const b = statusBucket(o.stateName);
      if (bucket === 'working') return IN_PROGRESS.has(b);
      if (bucket === 'problem') return b === 'problem';
      // all = всё, что не выполнено и не «без статуса»
      return b !== 'completed' && b !== 'unknown';
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const totalAmount = pending.reduce((s, o) => s + (o.totalAmount || 0), 0);

  return NextResponse.json({
    packer,
    bucket,
    from: from.toISOString(),
    to: to.toISOString(),
    count: pending.length,
    totalAmount,
    orders: pending.map((o) => ({
      id: o.id,
      number: o.number,
      date: o.date.toISOString(),
      shipmentDate: o.shipmentDate?.toISOString() || null,
      kontragentName: o.kontragentName,
      totalAmount: o.totalAmount,
      stateName: o.stateName,
    })),
  });
}

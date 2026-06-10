// Детализация воронки по источнику привлечения:
// - "bought":   контрагенты с продажей за период (сегмент «купили»)
// - "ordered":  контрагенты с заказом за период (сегмент «с заказом», включая тех кто и купил)
// - "lost":     контрагенты с заказом, но без продажи за период (потери)
// - "new":      контрагенты, чья ПЕРВАЯ покупка в истории попала в текущий период
//
// Параметры: sourceId (id источника, или 'unknown' для контрагентов без источника), from, to

import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const sourceId = sp.get('sourceId');
    if (!sourceId) return NextResponse.json({ error: 'sourceId required' }, { status: 400 });
    const from = sp.get('from') ? startOfDay(parseISO(sp.get('from')!)) : startOfMonth(new Date());
    const to = sp.get('to') ? endOfDay(parseISO(sp.get('to')!)) : endOfMonth(new Date());

    const isUnknown = sourceId === 'unknown';

    const contractors = await prisma.kontragent.findMany({
      where: {
        isFolder: false,
        attractionSourceId: isUnknown ? null : sourceId,
      },
      select: { id: true, name: true },
    });
    const kontIds = contractors.map((k) => k.id);
    const nameById = new Map(contractors.map((k) => [k.id, k.name]));
    if (kontIds.length === 0) {
      return NextResponse.json({
        sourceId, from: from.toISOString(), to: to.toISOString(),
        bought: [], ordered: [], lost: [], new: [],
      });
    }

    const [orderAgg, saleAgg, kgAgg, firstSales] = await Promise.all([
      prisma.orderBuyer.groupBy({
        by: ['kontragentId'],
        where: { posted: true, kontragentId: { in: kontIds }, date: { gte: from, lte: to } },
        _count: true,
        _sum: { totalAmount: true, paidAmount: true },
      }),
      prisma.realizacia.groupBy({
        by: ['kontragentId'],
        where: { posted: true, kontragentId: { in: kontIds }, date: { gte: from, lte: to } },
        _count: true,
        _sum: { itemsAmount: true, factCost: true, totalCost: true },
      }),
      prisma.$queryRaw<Array<{ kontragentId: string; kg: number }>>`
        SELECT r."kontragentId" AS "kontragentId", SUM(ri.quantity)::float AS kg
        FROM "RealizaciaItem" ri
        JOIN "Realizacia" r ON r.id = ri."realizaciaId"
        WHERE r.posted = true
          AND r."kontragentId" = ANY(${kontIds}::text[])
          AND r.date >= ${from} AND r.date <= ${to}
        GROUP BY r."kontragentId"
      `,
      prisma.realizacia.groupBy({
        by: ['kontragentId'],
        where: { posted: true, kontragentId: { in: kontIds } },
        _min: { date: true },
      }),
    ]);

    const ordersByKont = new Map<string, { count: number; amount: number; paid: number }>();
    for (const o of orderAgg) {
      if (!o.kontragentId) continue;
      ordersByKont.set(o.kontragentId, {
        count: o._count,
        amount: o._sum.totalAmount || 0,
        paid: o._sum.paidAmount || 0,
      });
    }

    const salesByKont = new Map<string, { count: number; amount: number; profit: number }>();
    for (const s of saleAgg) {
      if (!s.kontragentId) continue;
      const amt = s._sum.itemsAmount || 0;
      const cost = s._sum.factCost ?? s._sum.totalCost ?? 0;
      salesByKont.set(s.kontragentId, { count: s._count, amount: amt, profit: amt - cost });
    }

    const kgByKont = new Map<string, number>();
    for (const k of kgAgg) kgByKont.set(k.kontragentId, k.kg);

    const firstByKont = new Map<string, Date | null>();
    for (const f of firstSales) firstByKont.set(f.kontragentId!, f._min.date);

    const bought: any[] = [];
    const ordered: any[] = [];
    const lost: any[] = [];
    const newOnes: any[] = [];

    for (const kid of kontIds) {
      const o = ordersByKont.get(kid);
      const s = salesByKont.get(kid);
      const name = nameById.get(kid) || '—';
      if (o) {
        ordered.push({
          kontragentId: kid, kontragentName: name,
          ordersCount: o.count, ordersAmount: o.amount, paidAmount: o.paid,
          salesAmount: s?.amount || 0, kg: kgByKont.get(kid) || 0,
        });
      }
      if (s) {
        bought.push({
          kontragentId: kid, kontragentName: name,
          salesCount: s.count, salesAmount: s.amount, profit: s.profit,
          kg: kgByKont.get(kid) || 0,
        });
      }
      if (o && !s) {
        lost.push({
          kontragentId: kid, kontragentName: name,
          ordersCount: o.count, ordersAmount: o.amount, paidAmount: o.paid,
        });
      }
      if (s) {
        const fd = firstByKont.get(kid);
        if (fd && fd >= from && fd <= to) {
          newOnes.push({
            kontragentId: kid, kontragentName: name,
            salesAmount: s.amount, kg: kgByKont.get(kid) || 0,
            firstSaleDate: fd.toISOString(),
          });
        }
      }
    }

    bought.sort((a, b) => b.salesAmount - a.salesAmount);
    ordered.sort((a, b) => b.ordersAmount - a.ordersAmount);
    lost.sort((a, b) => b.ordersAmount - a.ordersAmount);
    newOnes.sort((a, b) => b.salesAmount - a.salesAmount);

    return NextResponse.json({
      sourceId,
      from: from.toISOString(),
      to: to.toISOString(),
      bought,
      ordered,
      lost,
      new: newOnes,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

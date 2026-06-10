import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const name = sp.get('name');
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const from = sp.get('from') ? startOfDay(parseISO(sp.get('from')!)) : startOfMonth(new Date());
    const to = sp.get('to') ? endOfDay(parseISO(sp.get('to')!)) : endOfMonth(new Date());

    const [topClients, topSkus, recentOrders, recentSales] = await Promise.all([
      prisma.$queryRaw<Array<{
        kontragentId: string | null;
        kontragentName: string | null;
        salesCount: bigint;
        amount: number;
        kg: number;
      }>>`
        SELECT
          r."kontragentId" AS "kontragentId",
          MAX(r."kontragentName") AS "kontragentName",
          COUNT(DISTINCT r.id) AS "salesCount",
          SUM(r."itemsAmount")::float AS amount,
          SUM(ri.quantity)::float AS kg
        FROM "Realizacia" r
        LEFT JOIN "RealizaciaItem" ri ON ri."realizaciaId" = r.id
        WHERE r.posted = true
          AND r."responsibleName" = ${name}
          AND r.date >= ${from} AND r.date <= ${to}
        GROUP BY r."kontragentId"
        ORDER BY amount DESC NULLS LAST
        LIMIT 20
      `,
      prisma.$queryRaw<Array<{
        nomenclatureId: string | null;
        nomenclatureName: string | null;
        kg: number;
        amount: number;
      }>>`
        SELECT
          ri."nomenclatureId" AS "nomenclatureId",
          MAX(ri."nomenclatureName") AS "nomenclatureName",
          SUM(ri.quantity)::float AS kg,
          SUM(ri.amount)::float AS amount
        FROM "RealizaciaItem" ri
        JOIN "Realizacia" r ON r.id = ri."realizaciaId"
        WHERE r.posted = true
          AND r."responsibleName" = ${name}
          AND r.date >= ${from} AND r.date <= ${to}
        GROUP BY ri."nomenclatureId"
        ORDER BY amount DESC NULLS LAST
        LIMIT 20
      `,
      prisma.orderBuyer.findMany({
        where: { posted: true, responsibleName: name, date: { gte: from, lte: to } },
        select: {
          id: true, date: true, number: true,
          kontragentName: true, totalAmount: true, paidAmount: true, status: true,
        },
        orderBy: { date: 'desc' },
        take: 50,
      }),
      prisma.realizacia.findMany({
        where: { posted: true, responsibleName: name, date: { gte: from, lte: to } },
        select: {
          id: true, date: true, number: true,
          kontragentName: true, itemsAmount: true, factCost: true, totalCost: true,
          items: { select: { quantity: true } },
        },
        orderBy: { date: 'desc' },
        take: 50,
      }),
    ]);

    return NextResponse.json({
      name,
      from: from.toISOString(),
      to: to.toISOString(),
      topClients: topClients.map((c) => ({
        kontragentId: c.kontragentId,
        kontragentName: c.kontragentName || '—',
        salesCount: Number(c.salesCount),
        amount: c.amount || 0,
        kg: c.kg || 0,
      })),
      topSkus: topSkus.map((s) => ({
        nomenclatureId: s.nomenclatureId,
        nomenclatureName: s.nomenclatureName || '—',
        kg: s.kg || 0,
        amount: s.amount || 0,
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        date: o.date.toISOString(),
        number: o.number,
        kontragentName: o.kontragentName || '—',
        totalAmount: o.totalAmount,
        paidAmount: o.paidAmount,
        status: o.status,
      })),
      recentSales: recentSales.map((s) => ({
        id: s.id,
        date: s.date.toISOString(),
        number: s.number,
        kontragentName: s.kontragentName || '—',
        itemsAmount: s.itemsAmount,
        cost: s.factCost ?? s.totalCost ?? 0,
        kg: s.items.reduce((acc, it) => acc + (it.quantity || 0), 0),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

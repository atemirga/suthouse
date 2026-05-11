import { prisma } from '@/lib/db';
import { differenceInDays } from 'date-fns';

export interface RnpFilters {
  status?: string | string[]; // 'Открыт' | 'ВРаботе' | 'Выполнен' | 'all'
  responsible?: string;
  kontragentId?: string;
  from?: Date;
  to?: Date;
}

export interface RnpRow {
  id: string;
  date: Date;
  number: string;
  kontragentName: string | null;
  responsibleName: string | null;
  status: string | null;
  totalAmount: number;
  paidAmount: number;
  paymentLeft: number;
  shippedAmount: number;
  shipmentLeft: number;
  shipmentDate: Date | null;
  daysInWork: number;
  comment: string | null;
}

export interface RnpReport {
  rows: RnpRow[];
  summary: {
    totalOrders: number;
    totalAmount: number;
    totalPaid: number;
    totalShipped: number;
    advancesReceived: number; // оплачено больше чем отгружено
    expectedRevenue: number; // сумма заказа − отгружено
  };
}

export async function buildRnp(filters: RnpFilters = {}): Promise<RnpReport> {
  const where: any = { posted: true };
  // В разных конфигурациях УНФ "открытые" заказы выглядят по-разному:
  // - Стандарт УНФ: статусы Открыт / ВРаботе
  // - УНФ KZ 1.6: вид операции ЗаказНаПродажу (заказ "в работе" пока есть остаток отгрузки/оплаты)
  // Если status='all' — без фильтра. Если конкретный — точное совпадение.
  // По умолчанию показываем те, у которых остаток отгрузки > 0 (ниже в коде).
  const statuses = filters.status === 'all' ? null
    : Array.isArray(filters.status) ? filters.status
    : filters.status ? [filters.status]
    : null; // дефолт: без фильтра по статусу — фильтруем по shipmentLeft в постпроцессинге
  if (statuses) where.status = { in: statuses };
  if (filters.responsible) where.responsibleName = filters.responsible;
  if (filters.kontragentId) where.kontragentId = filters.kontragentId;
  if (filters.from || filters.to) {
    where.date = {};
    if (filters.from) where.date.gte = filters.from;
    if (filters.to) where.date.lte = filters.to;
  }

  const orders = await prisma.orderBuyer.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 2000,
  });

  // Считаем отгрузки (реализации) по контрагенту с даты заказа.
  // Это приближение — точная связка заказ-реализация в УНФ не всегда явная.
  const kontragentIds = Array.from(new Set(orders.map((o) => o.kontragentId).filter(Boolean) as string[]));
  const realizacii = kontragentIds.length
    ? await prisma.realizacia.findMany({
        where: { kontragentId: { in: kontragentIds }, posted: true },
        select: { kontragentId: true, date: true, totalAmount: true },
      })
    : [];

  const today = new Date();
  let rows: RnpRow[] = orders.map((o) => {
    const shipped = realizacii
      .filter((r) => r.kontragentId === o.kontragentId && r.date >= o.date)
      .reduce((s, r) => s + r.totalAmount, 0);
    return {
      id: o.id,
      date: o.date,
      number: o.number,
      kontragentName: o.kontragentName,
      responsibleName: o.responsibleName,
      status: o.status,
      totalAmount: o.totalAmount,
      paidAmount: o.paidAmount,
      paymentLeft: Math.max(0, o.totalAmount - o.paidAmount),
      shippedAmount: shipped,
      shipmentLeft: Math.max(0, o.totalAmount - shipped),
      shipmentDate: o.shipmentDate,
      daysInWork: differenceInDays(today, o.date),
      comment: o.comment,
    };
  });
  // По умолчанию (фильтр статуса не задан) — показываем заказы с остатком по отгрузке
  if (!filters.status) {
    rows = rows.filter((r) => r.shipmentLeft > 0 || r.paymentLeft > 0);
  }

  const summary = rows.reduce(
    (acc, r) => {
      acc.totalOrders++;
      acc.totalAmount += r.totalAmount;
      acc.totalPaid += r.paidAmount;
      acc.totalShipped += r.shippedAmount;
      const advance = r.paidAmount - r.shippedAmount;
      if (advance > 0) acc.advancesReceived += advance;
      acc.expectedRevenue += r.shipmentLeft;
      return acc;
    },
    { totalOrders: 0, totalAmount: 0, totalPaid: 0, totalShipped: 0, advancesReceived: 0, expectedRevenue: 0 },
  );

  return { rows, summary };
}

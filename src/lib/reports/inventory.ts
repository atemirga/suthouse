// Остатки товаров с аналитикой:
// - quantity   : снимок из AccumulationRegister_ЗапасыНаСкладах (InventoryBalance)
// - costPrice  : последняя закупочная цена (buildCostPriceMap) — приближение,
//                с которым согласуется списание реализаций до пересчёта FIFO
// - costAmount : quantity * costPrice — оценка денег, замороженных в остатке
// - sold30/90  : сколько кг продано за последние N дней (RealizaciaItem.quantity)
// - daysCover  : days of supply = quantity / (sold30 / 30)
// - reorderQty : сколько закупить на 30 дней вперёд = max(0, 30*velocity - stock)
//
// Все товары весовые — единица всегда «кг», поэтому velocity сравним напрямую.

import { prisma } from '@/lib/db';
import { buildCostPriceMap } from '@/lib/sync/zakupki';

export interface InventoryRow {
  warehouseId: string;
  warehouseName: string;
  nomenclatureId: string;
  nomenclatureName: string;
  quantity: number;
  costPrice: number;
  costAmount: number;
  sold30: number;
  sold90: number;
  velocity30: number;     // кг/день за 30 дней
  daysCover: number;      // дней покрытия по velocity30 (Infinity если нет продаж)
  reorderQty: number;     // рекомендованная закупка на 30 дней
  reorderAmount: number;  // reorderQty * costPrice
}

export interface InventoryReport {
  asOfDate: Date | null;
  coverDays: number;
  totals: {
    warehouses: number;
    positions: number;
    quantity: number;
    costAmount: number;
    sold30: number;
    sold90: number;
    reorderQty: number;
    reorderAmount: number;
  };
  byWarehouse: { name: string; positions: number; quantity: number; costAmount: number }[];
  rows: InventoryRow[];
}

export async function buildInventory(opts: { warehouseId?: string; limit?: number; coverDays?: number } = {}): Promise<InventoryReport> {
  const coverDays = opts.coverDays ?? 30;
  const where: any = {};
  if (opts.warehouseId) where.warehouseId = opts.warehouseId;

  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [items, sample, costMap, sold30, sold90] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where,
      orderBy: [{ warehouseName: 'asc' }, { quantity: 'desc' }],
      take: opts.limit || 10000,
    }),
    prisma.inventoryBalance.findFirst({ select: { asOfDate: true } }),
    buildCostPriceMap(),
    prisma.$queryRaw<Array<{ nomenclatureId: string; kg: number }>>`
      SELECT ri."nomenclatureId" AS "nomenclatureId", SUM(ri.quantity)::float AS kg
      FROM "RealizaciaItem" ri
      JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.posted = true AND r.date >= ${since30} AND ri."nomenclatureId" IS NOT NULL
      GROUP BY ri."nomenclatureId"
    `,
    prisma.$queryRaw<Array<{ nomenclatureId: string; kg: number }>>`
      SELECT ri."nomenclatureId" AS "nomenclatureId", SUM(ri.quantity)::float AS kg
      FROM "RealizaciaItem" ri
      JOIN "Realizacia" r ON r.id = ri."realizaciaId"
      WHERE r.posted = true AND r.date >= ${since90} AND ri."nomenclatureId" IS NOT NULL
      GROUP BY ri."nomenclatureId"
    `,
  ]);

  const sold30Map = new Map<string, number>();
  for (const s of sold30) sold30Map.set(s.nomenclatureId, s.kg);
  const sold90Map = new Map<string, number>();
  for (const s of sold90) sold90Map.set(s.nomenclatureId, s.kg);

  const rows: InventoryRow[] = items.map((r) => {
    const cp = costMap.get(r.nomenclatureId) || 0;
    const s30 = sold30Map.get(r.nomenclatureId) || 0;
    const s90 = sold90Map.get(r.nomenclatureId) || 0;
    const v30 = s30 / 30;
    const cover = v30 > 0 ? r.quantity / v30 : Infinity;
    const reorderQty = v30 > 0 ? Math.max(0, coverDays * v30 - r.quantity) : 0;
    return {
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName || '—',
      nomenclatureId: r.nomenclatureId,
      nomenclatureName: r.nomenclatureName || '—',
      quantity: r.quantity,
      costPrice: cp,
      costAmount: r.quantity * cp,
      sold30: s30,
      sold90: s90,
      velocity30: v30,
      daysCover: cover,
      reorderQty,
      reorderAmount: reorderQty * cp,
    };
  });

  const wMap = new Map<string, { positions: number; quantity: number; costAmount: number }>();
  for (const r of rows) {
    let w = wMap.get(r.warehouseName);
    if (!w) { w = { positions: 0, quantity: 0, costAmount: 0 }; wMap.set(r.warehouseName, w); }
    w.positions += 1;
    w.quantity += r.quantity;
    w.costAmount += r.costAmount;
  }

  const totals = {
    warehouses: wMap.size,
    positions: rows.length,
    quantity: rows.reduce((s, r) => s + r.quantity, 0),
    costAmount: rows.reduce((s, r) => s + r.costAmount, 0),
    sold30: rows.reduce((s, r) => s + r.sold30, 0),
    sold90: rows.reduce((s, r) => s + r.sold90, 0),
    reorderQty: rows.reduce((s, r) => s + r.reorderQty, 0),
    reorderAmount: rows.reduce((s, r) => s + r.reorderAmount, 0),
  };

  return {
    asOfDate: sample?.asOfDate || null,
    coverDays,
    totals,
    byWarehouse: Array.from(wMap.entries()).map(([name, v]) => ({ name, ...v })),
    rows,
  };
}

export async function listWarehouses() {
  const rows = await prisma.inventoryBalance.findMany({
    distinct: ['warehouseId'],
    select: { warehouseId: true, warehouseName: true },
    orderBy: { warehouseName: 'asc' },
  });
  return rows.map((r) => ({ id: r.warehouseId, name: r.warehouseName || '—' }));
}

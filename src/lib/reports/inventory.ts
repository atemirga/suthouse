import { prisma } from '@/lib/db';

export interface InventoryRow {
  warehouseId: string;
  warehouseName: string;
  nomenclatureId: string;
  nomenclatureName: string;
  quantity: number;
}

export interface InventoryReport {
  asOfDate: Date | null;
  totals: { warehouses: number; positions: number; quantity: number };
  byWarehouse: { name: string; positions: number; quantity: number }[];
  rows: InventoryRow[];
}

export async function buildInventory(opts: { warehouseId?: string; limit?: number } = {}): Promise<InventoryReport> {
  const where: any = {};
  if (opts.warehouseId) where.warehouseId = opts.warehouseId;

  const [items, sample] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where,
      orderBy: [{ warehouseName: 'asc' }, { quantity: 'desc' }],
      take: opts.limit || 5000,
    }),
    prisma.inventoryBalance.findFirst({ select: { asOfDate: true } }),
  ]);

  const wMap = new Map<string, { positions: number; quantity: number }>();
  for (const r of items) {
    const wn = r.warehouseName || '—';
    let w = wMap.get(wn);
    if (!w) { w = { positions: 0, quantity: 0 }; wMap.set(wn, w); }
    w.positions += 1;
    w.quantity += r.quantity;
  }

  const byWarehouse = Array.from(wMap.entries()).map(([name, v]) => ({ name, ...v }));

  return {
    asOfDate: sample?.asOfDate || null,
    totals: {
      warehouses: byWarehouse.length,
      positions: items.length,
      quantity: items.reduce((s, r) => s + r.quantity, 0),
    },
    byWarehouse,
    rows: items.map((r) => ({
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName || '—',
      nomenclatureId: r.nomenclatureId,
      nomenclatureName: r.nomenclatureName || '—',
      quantity: r.quantity,
    })),
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

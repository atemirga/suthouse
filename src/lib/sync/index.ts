import { prisma } from '@/lib/db';
import { syncAllCatalogs } from './catalogs';
import { syncDds } from './dds';
import { syncZakupki } from './zakupki';
import { syncRealizacii } from './realizacii';
import { syncOrders } from './orders';
import { syncWriteOffs, syncCapitalizations } from './inventory';
import { recomputeFifoCosts } from './fifo';

export interface SyncResult {
  ok: boolean;
  durationMs: number;
  details: Record<string, any>;
  error?: string;
}

export async function runFullSync(opts: { daysBack?: number; skipCatalogs?: boolean } = {}): Promise<SyncResult> {
  const log = await prisma.syncLog.create({ data: { status: 'running' } });
  const t0 = Date.now();
  const details: Record<string, any> = {};

  try {
    if (!opts.skipCatalogs) {
      details.catalogs = await syncAllCatalogs();
    }

    // Закупки и реализации сначала — для FIFO нужны обе полные таблицы.
    // syncRealizacii ставит costPrice по «последней закупочной цене» как
    // временное приближение; ниже recomputeFifoCosts перезаписывает их
    // настоящим FIFO по полной хронологии партий.
    details.zakupki = await syncZakupki(opts.daysBack);
    details.realizacii = await syncRealizacii(opts.daysBack);
    try {
      details.fifo = await recomputeFifoCosts();
    } catch (e: any) {
      details.fifo = { error: e?.message || String(e) };
    }

    // ДДС, заказы, инвентарь — независимы. allSettled чтобы один сбой не валил остальные.
    const [dds, orders, writeOffs, capitalizations] = await Promise.allSettled([
      syncDds(opts.daysBack),
      syncOrders(opts.daysBack),
      syncWriteOffs(opts.daysBack),
      syncCapitalizations(opts.daysBack),
    ]);
    details.dds = dds.status === 'fulfilled' ? dds.value : { error: (dds as any).reason?.message || String((dds as any).reason) };
    details.orders = orders.status === 'fulfilled' ? orders.value : { error: (orders as any).reason?.message || String((orders as any).reason) };
    details.writeOffs = writeOffs.status === 'fulfilled' ? writeOffs.value : { error: (writeOffs as any).reason?.message || String((writeOffs as any).reason) };
    details.capitalizations = capitalizations.status === 'fulfilled' ? capitalizations.value : { error: (capitalizations as any).reason?.message || String((capitalizations as any).reason) };

    const durationMs = Date.now() - t0;
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        details: JSON.stringify(details),
      },
    });
    return { ok: true, durationMs, details };
  } catch (e: any) {
    const durationMs = Date.now() - t0;
    const error = e?.message || String(e);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: 'error',
        finishedAt: new Date(),
        details: JSON.stringify(details),
        error,
      },
    });
    return { ok: false, durationMs, details, error };
  }
}

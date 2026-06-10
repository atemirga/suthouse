import { prisma } from '@/lib/db';
import { syncAllCatalogs } from './catalogs';
import { syncDds } from './dds';
import { syncZakupki } from './zakupki';
import { syncRealizacii } from './realizacii';
import { syncOrders } from './orders';
import { syncWriteOffs, syncCapitalizations } from './inventory';
import { syncMonthCloses } from './month-close';
import { recomputeFifoCosts } from './fifo';
import { syncFactCost } from './fact-cost';
import { syncOpeningBalances } from './openings';
import { syncSalesPlans } from './sales-plans';
import { syncSinceDate } from './utils';

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

    // Закупки + реализации + списания — все нужны до FIFO. Списания тоже
    // потребляют из той же FIFO-очереди (одни и те же партии), поэтому
    // их считаем тем же проходом.
    details.zakupki = await syncZakupki(opts.daysBack);
    const [realiz, writeOffs] = await Promise.allSettled([
      syncRealizacii(opts.daysBack),
      syncWriteOffs(opts.daysBack),
    ]);
    details.realizacii = realiz.status === 'fulfilled' ? realiz.value : { error: (realiz as any).reason?.message || String((realiz as any).reason) };
    details.writeOffs = writeOffs.status === 'fulfilled' ? writeOffs.value : { error: (writeOffs as any).reason?.message || String((writeOffs as any).reason) };

    try {
      details.fifo = await recomputeFifoCosts();
    } catch (e: any) {
      details.fifo = { error: e?.message || String(e) };
    }

    // Фактическая себестоимость из 1С — отдельный регистр, точное соответствие
    // финансисту. Загружаем после FIFO, перекрывает поле factCost. За окно syncSinceDate.
    try {
      details.factCost = await syncFactCost(syncSinceDate(opts.daysBack), new Date());
    } catch (e: any) {
      details.factCost = { error: e?.message || String(e) };
    }

    // ДДС, заказы, оприходования, закрытия месяца — независимы. allSettled чтобы один сбой не валил остальные.
    const [dds, orders, capitalizations, monthCloses] = await Promise.allSettled([
      syncDds(opts.daysBack),
      syncOrders(opts.daysBack),
      syncCapitalizations(opts.daysBack),
      syncMonthCloses(),
    ]);
    details.dds = dds.status === 'fulfilled' ? dds.value : { error: (dds as any).reason?.message || String((dds as any).reason) };
    details.orders = orders.status === 'fulfilled' ? orders.value : { error: (orders as any).reason?.message || String((orders as any).reason) };
    details.capitalizations = capitalizations.status === 'fulfilled' ? capitalizations.value : { error: (capitalizations as any).reason?.message || String((capitalizations as any).reason) };
    details.monthCloses = monthCloses.status === 'fulfilled' ? monthCloses.value : { error: (monthCloses as any).reason?.message || String((monthCloses as any).reason) };

    // Opening balances пересчитываем последним шагом — после того как все
    // документы синхронизированы и MIN(date) актуальна. 1С может задним числом
    // проводить документы, что меняет исторические балансы регистра — opening
    // должен подтягиваться каждый тик, иначе ДДС-по-кассам разъезжается
    // с 1С (см. [[dds-by-kassa-transfers]]).
    try {
      details.openings = await syncOpeningBalances();
    } catch (e: any) {
      details.openings = { error: e?.message || String(e) };
    }

    // План продаж — best-effort. Если в этой конфигурации 1С нет такого
    // документа (или ресурс по другому именованию), вернёт noResource:true,
    // ручные планы из /sales/plans продолжают работать.
    try {
      details.salesPlans = await syncSalesPlans();
    } catch (e: any) {
      details.salesPlans = { error: e?.message || String(e) };
    }

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

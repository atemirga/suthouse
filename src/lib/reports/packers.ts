// Отчёт по упаковщикам.
//
// «Заказ» = фактически отгруженный документ — `Realizacia` (расходная накладная).
// OrderBuyer.packerName используется ТОЛЬКО как источник имени упаковщика:
// для каждой расходной ищем матчингующий заказ покупателя по
// (kontragentId, |Realizacia.date − OrderBuyer.shipmentDate| ≤ 3 дня) и берём
// packerName оттуда. Без матчинга упаковщик неизвестен → «— без упаковщика —».
//
// Дополнительно показываем «оформлено (ещё не отгружено)» — OrderBuyer без
// соответствующей Realizacia. Это информация о текущей очереди, в основной
// KPI «Заказов» она НЕ входит (клиент мог ещё передумать).
//
// КГ берётся из RealizaciaItem.quantity.
//
// Примечание: бывают Realizacia без OrderBuyer (документ оформлен напрямую) —
// они попадут в «— без упаковщика —».

import { prisma } from '@/lib/db';

const MATCH_WINDOW_DAYS = 3;

// Расширенная классификация СостоянияЗаказа из 1С — для KPI «по статусам».
// Маппинг:
//   - working:     «В работе»
//   - otk:         «ОТК Зав Склад» (контроль склада)
//   - otk_manager: «ОТК Менеджер» (контроль менеджера)
//   - waiting:     «В ожидании»
//   - problem:     «Проблема», «Исправить ошибку», «Ошибка упаковщик и менед»
//   - completed:   «Завершен ...» (обычно сматчены с Realizacia)
//   - unknown:     null или незнакомое состояние
export type StatusBucket = 'working' | 'otk' | 'otk_manager' | 'waiting' | 'problem' | 'completed' | 'unknown';

export const STATUS_BUCKETS: StatusBucket[] = ['working', 'otk', 'otk_manager', 'waiting', 'problem', 'completed', 'unknown'];

export const STATUS_LABELS: Record<StatusBucket, string> = {
  working: 'В работе',
  otk: 'ОТК',
  otk_manager: 'Менеджер',
  waiting: 'Ожидания',
  problem: 'Проблема',
  completed: 'Завершен',
  unknown: 'Без статуса',
};

export function statusBucket(stateName: string | null): StatusBucket {
  if (!stateName) return 'unknown';
  const s = stateName.toLowerCase();
  if (s.includes('проблема') || s.includes('ошибка')) return 'problem';
  if (s.includes('завершен')) return 'completed';
  if (s.includes('ожидани')) return 'waiting';
  if (s.includes('отк менеджер') || (s.includes('менеджер') && !s.includes('склад'))) return 'otk_manager';
  if (s.includes('отк')) return 'otk';
  if (s.includes('в работе')) return 'working';
  return 'unknown';
}

export type StatusCounts = Record<StatusBucket, { count: number; amount: number }>;

function emptyStatusCounts(): StatusCounts {
  const out = {} as StatusCounts;
  for (const k of STATUS_BUCKETS) out[k] = { count: 0, amount: 0 };
  return out;
}

export interface PackerRow {
  name: string;

  // Отгружено (= количество расходных накладных, отнесённых к упаковщику)
  ordersCount: number;
  ordersAmount: number;
  shippedKg: number;

  // OrderBuyer без Realizacia, классифицированные по СостояниюЗаказа из 1С.
  // Состояния «Проблема», «Исправить ошибку», «Ошибка упаковщик и менед» → problem.
  // Всё остальное (В работе, ОТК Менеджер, ОТК Зав Склад, В ожидании и пр.) → working.
  // Эти два счётчика оставлены для обратной совместимости.
  workingCount: number;
  workingAmount: number;
  problemCount: number;
  problemAmount: number;

  // Детальная разбивка ВСЕХ OrderBuyer за период по статусу (включая completed,
  // т.е. сматченные). Используется для KPI «по статусам».
  byStatus: StatusCounts;

  avgOrder: number;            // средний заказ по сумме (по отгруженным)
  share: number;               // доля от итога по количеству (по отгруженным)

  // Дневная разбивка по дате документа Realizacia (для pending — по shipmentDate/date заказа).
  byDay: PackerDayRow[];
}

export interface PackerDayRow {
  date: string;          // 'yyyy-MM-dd'
  ordersCount: number;   // отгружено в этот день
  workingCount: number;  // в работе на эту дату отгрузки
  problemCount: number;
  shippedKg: number;
}

export interface PackersReport {
  from: Date;
  to: Date;
  totals: {
    ordersCount: number;
    ordersAmount: number;
    shippedKg: number;
    workingCount: number;
    workingAmount: number;
    problemCount: number;
    problemAmount: number;
    byStatus: StatusCounts;
  };
  rows: PackerRow[];
}

export async function buildPackersReport(opts: { from: Date; to: Date }): Promise<PackersReport> {
  const expandedFrom = new Date(opts.from.getTime() - MATCH_WINDOW_DAYS * 86400 * 1000);
  const expandedTo = new Date(opts.to.getTime() + MATCH_WINDOW_DAYS * 86400 * 1000);

  // Берём Realizacia и OrderBuyer в расширенном окне (±3 дня) — нужно для
  // правильного матчинга на границах периода. В KPI попадают только Realizacia
  // с датой в [from, to], но матчинг учитывает и соседние документы:
  // OrderBuyer 31 мая, отгруженный 2 июня, не должен считаться pending в мае.
  const [realizacii, orders, itemsAgg] = await Promise.all([
    prisma.realizacia.findMany({
      where: { posted: true, date: { gte: expandedFrom, lte: expandedTo } },
      select: { id: true, kontragentId: true, date: true, totalAmount: true },
    }),
    prisma.orderBuyer.findMany({
      where: { posted: true, date: { gte: expandedFrom, lte: expandedTo } },
      select: {
        id: true, packerName: true, kontragentId: true,
        shipmentDate: true, date: true, totalAmount: true, stateName: true,
      },
    }),
    prisma.$queryRaw<Array<{realizaciaId: string; quantity: number}>>`
      SELECT "realizaciaId", SUM(quantity)::float AS quantity
      FROM "RealizaciaItem"
      WHERE "realizaciaId" IN (
        SELECT id FROM "Realizacia"
        WHERE posted = true AND date >= ${opts.from} AND date <= ${opts.to}
      )
      GROUP BY "realizaciaId"
    `,
  ]);

  const kgByRealiz = new Map<string, number>();
  for (const r of itemsAgg) kgByRealiz.set(r.realizaciaId, r.quantity);

  // Индекс заказов по kontragentId — для быстрого матчинга Realizacia → OrderBuyer.
  type OrderRec = typeof orders[number];
  const ordersByKont = new Map<string, OrderRec[]>();
  for (const o of orders) {
    if (!o.kontragentId) continue;
    let arr = ordersByKont.get(o.kontragentId);
    if (!arr) { arr = []; ordersByKont.set(o.kontragentId, arr); }
    arr.push(o);
  }
  // Сортируем по shipmentDate || date для стабильного матчинга.
  for (const arr of ordersByKont.values()) {
    arr.sort((a, b) => (a.shipmentDate?.getTime() || a.date.getTime()) - (b.shipmentDate?.getTime() || b.date.getTime()));
  }

  const usedOrders = new Set<string>();

  function findOrderForRealizacia(kontragentId: string | null, realizDate: Date): OrderRec | null {
    if (!kontragentId) return null;
    const arr = ordersByKont.get(kontragentId);
    if (!arr) return null;
    const refMs = realizDate.getTime();
    let best: { o: OrderRec; absDiff: number } | null = null;
    for (const o of arr) {
      if (usedOrders.has(o.id)) continue;
      const oDateMs = (o.shipmentDate || o.date).getTime();
      const diff = Math.abs(oDateMs - refMs);
      if (diff > MATCH_WINDOW_DAYS * 86400 * 1000) continue;
      if (!best || diff < best.absDiff) best = { o, absDiff: diff };
    }
    return best ? best.o : null;
  }

  const byPacker = new Map<string, PackerRow>();
  function ensure(name: string): PackerRow {
    let r = byPacker.get(name);
    if (!r) {
      r = {
        name,
        ordersCount: 0, ordersAmount: 0, shippedKg: 0,
        workingCount: 0, workingAmount: 0,
        problemCount: 0, problemAmount: 0,
        byStatus: emptyStatusCounts(),
        avgOrder: 0, share: 0,
        byDay: [],
      };
      byPacker.set(name, r);
    }
    return r;
  }

  // Ключ дня — yyyy-MM-dd в TZ Asia/Almaty. Иначе документы созданные после
  // 19:00 Almaty (= 14:00 UTC) попадают в «следующий» день по UTC и
  // дневная разбивка не совпадает с тем, что видит пользователь в 1С.
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  function dayKey(d: Date): string {
    return dayFmt.format(d);
  }

  const dayMap = new Map<string, Map<string, PackerDayRow>>();
  function ensureDay(packer: string, key: string): PackerDayRow {
    let m = dayMap.get(packer);
    if (!m) { m = new Map(); dayMap.set(packer, m); }
    let d = m.get(key);
    if (!d) {
      d = { date: key, ordersCount: 0, workingCount: 0, problemCount: 0, shippedKg: 0 };
      m.set(key, d);
    }
    return d;
  }

  // Идём по всем расходным в расширенном окне — мечаем сматченные OrderBuyer.
  // Но в KPI попадают только Realizacia с датой в [from, to].
  const realizSorted = [...realizacii].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const r of realizSorted) {
    const matchedOrder = findOrderForRealizacia(r.kontragentId, r.date);
    if (matchedOrder) usedOrders.add(matchedOrder.id);

    const inPeriod = r.date >= opts.from && r.date <= opts.to;
    if (!inPeriod) continue;

    const packer = matchedOrder?.packerName || '— без упаковщика —';
    const row = ensure(packer);
    row.ordersCount++;
    row.ordersAmount += r.totalAmount || 0;
    row.shippedKg += kgByRealiz.get(r.id) || 0;

    const dKey = dayKey(r.date);
    const d = ensureDay(packer, dKey);
    d.ordersCount++;
    d.shippedKg += kgByRealiz.get(r.id) || 0;
  }

  // OrderBuyer в [from, to] классифицируем по СостояниюЗаказа из 1С.
  // Считаем по ВСЕМ заказам (не только unmatched), но детальные бакеты —
  // те же, что показываем в верхней плашке «Статусы заказов» (statusBucket).
  // Так суммы низа = суммам верха.
  //   workingCount = working + otk + otk_manager + waiting (всё «в процессе»)
  //   problemCount = problem
  //   completed / unknown в KPI «В работе»/«Проблема» не входят, чтобы
  //   завершённые не путали глаз.
  const IN_PROGRESS_BUCKETS = new Set(['working', 'otk', 'otk_manager', 'waiting']);
  for (const o of orders) {
    if (o.date < opts.from || o.date > opts.to) continue;
    const packer = o.packerName || '— без упаковщика —';
    const row = ensure(packer);
    const b = statusBucket(o.stateName);
    if (b === 'problem') {
      row.problemCount++;
      row.problemAmount += o.totalAmount || 0;
    } else if (IN_PROGRESS_BUCKETS.has(b)) {
      row.workingCount++;
      row.workingAmount += o.totalAmount || 0;
    }

    const refDate = o.shipmentDate || o.date;
    const dKey = dayKey(refDate);
    const d = ensureDay(packer, dKey);
    if (b === 'problem') d.problemCount++;
    else if (IN_PROGRESS_BUCKETS.has(b)) d.workingCount++;
  }

  for (const [packer, m] of dayMap.entries()) {
    const row = byPacker.get(packer);
    if (!row) continue;
    row.byDay = Array.from(m.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  // Подсчёт ВСЕХ OrderBuyer за период по статусу (в т.ч. сматченных с
  // Realizacia — они идут в byStatus.completed). Это даёт независимую от
  // матчинга воронку «работа → ОТК → завершён».
  for (const o of orders) {
    if (o.date < opts.from || o.date > opts.to) continue;
    const packer = o.packerName || '— без упаковщика —';
    const row = ensure(packer);
    const b = statusBucket(o.stateName);
    row.byStatus[b].count++;
    row.byStatus[b].amount += o.totalAmount || 0;
  }

  const totalCount = Array.from(byPacker.values()).reduce((s, r) => s + r.ordersCount, 0);

  const rows = Array.from(byPacker.values()).map((r) => {
    r.avgOrder = r.ordersCount > 0 ? r.ordersAmount / r.ordersCount : 0;
    r.share = totalCount > 0 ? r.ordersCount / totalCount : 0;
    return r;
  }).sort((a, b) => b.ordersCount - a.ordersCount);

  const totalsByStatus = emptyStatusCounts();
  for (const r of rows) {
    for (const k of STATUS_BUCKETS) {
      totalsByStatus[k].count += r.byStatus[k].count;
      totalsByStatus[k].amount += r.byStatus[k].amount;
    }
  }

  const totals = {
    ordersCount: rows.reduce((s, r) => s + r.ordersCount, 0),
    ordersAmount: rows.reduce((s, r) => s + r.ordersAmount, 0),
    shippedKg: rows.reduce((s, r) => s + r.shippedKg, 0),
    workingCount: rows.reduce((s, r) => s + r.workingCount, 0),
    workingAmount: rows.reduce((s, r) => s + r.workingAmount, 0),
    problemCount: rows.reduce((s, r) => s + r.problemCount, 0),
    problemAmount: rows.reduce((s, r) => s + r.problemAmount, 0),
    byStatus: totalsByStatus,
  };

  return { from: opts.from, to: opts.to, totals, rows };
}

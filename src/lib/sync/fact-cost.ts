// Синк фактической себестоимости из AccumulationRegister_Запасы_RecordType.
//
// ─── Зачем ──────────────────────────────────────────────────────────────────
// Раньше Realizacia.totalCost / WriteOff.totalAmount считались нашим FIFO
// (recomputeFifoCosts). Это нормально для большинства месяцев, но в закрытых
// месяцах 1С пересчитывает себестоимость (Document_РасчетФактическойСебестоимости)
// с учётом средневзвешенной и распределённых затрат. FIFO в закрытом
// месяце может расходиться с финансистом на 5–10%.
//
// Решение: брать «настоящую» себестоимость прямо из регистра 1С:
//   AccumulationRegister_Запасы_RecordType,
//   WHERE Recorder_Type IN ('Document_РасходнаяНакладная', 'Document_СписаниеЗапасов')
//       AND RecordType = 'Expense'
//       AND Active     = true
//   GROUP BY Recorder = sum(Сумма).
//
// Проверено: для янв–апр 2026 совпадает с финансистом в пределах ±2.5%
// (для свежего апреля 2026 — +0.13% к финансисту).
//
// ─── Как ────────────────────────────────────────────────────────────────────
// 1. Запрашиваем регистр пачками по 5000 строк за заданный период (один запрос
//    на оба типа документов — отделяем по Recorder_Type на клиенте).
// 2. Агрегируем по Recorder, разделяя на Realizacia / WriteOff.
// 3. UPDATE … SET factCost = ?, factCostSyncedAt = now() WHERE id = ?.
// Документы без записей в регистре остаются с factCost = NULL (fallback на totalCost).

import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

const PAGE_SIZE = 5000;
const REALIZ_TYPE = 'StandardODATA.Document_РасходнаяНакладная';
const WRITEOFF_TYPE = 'StandardODATA.Document_СписаниеЗапасов';

interface RegisterRow {
  Recorder?: string;
  Recorder_Type?: string;
  Сумма?: number;
}

export interface FactCostStats {
  rowsFetched: number;
  realizationsUpdated: number;
  writeOffsUpdated: number;
  realizCostTotal: number;
  writeOffCostTotal: number;
  durationMs: number;
}

export async function syncFactCost(from: Date, to: Date): Promise<FactCostStats> {
  const t0 = Date.now();
  const base = (process.env.ODATA_URL || '').replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${process.env.ODATA_LOGIN}:${process.env.ODATA_PASSWORD}`).toString('base64');

  const fromIso = from.toISOString().slice(0, 19);
  const toIso = to.toISOString().slice(0, 19);
  const select = 'Recorder,Recorder_Type,Сумма';
  // Один запрос: оба типа документов через OR.
  const filter = `Period ge datetime'${fromIso}' and Period lt datetime'${toIso}'`
    + ` and Active eq true and RecordType eq 'Expense'`
    + ` and (Recorder_Type eq '${REALIZ_TYPE}' or Recorder_Type eq '${WRITEOFF_TYPE}')`;

  const realizCost = new Map<string, number>();
  const writeOffCost = new Map<string, number>();
  let rowsFetched = 0;
  let skip = 0;
  while (true) {
    const url = `${base}/AccumulationRegister_Запасы_RecordType?$format=json`
      + `&$top=${PAGE_SIZE}&$skip=${skip}`
      + `&$select=${encodeURIComponent(select)}`
      + `&$filter=${encodeURIComponent(filter)}`
      + `&$orderby=Period`;
    const resp = await fetch(url, { headers: { Accept: 'application/json;odata=nometadata', Authorization: auth } });
    if (!resp.ok) {
      throw new Error(`OData ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    }
    const data = await resp.json() as { value: RegisterRow[] };
    const rows = data.value || [];
    for (const r of rows) {
      const id = r.Recorder;
      if (!id) continue;
      const sum = Number(r.Сумма || 0);
      if (r.Recorder_Type === REALIZ_TYPE) {
        realizCost.set(id, (realizCost.get(id) || 0) + sum);
      } else if (r.Recorder_Type === WRITEOFF_TYPE) {
        writeOffCost.set(id, (writeOffCost.get(id) || 0) + sum);
      }
    }
    rowsFetched += rows.length;
    if (rows.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  const now = new Date();
  const BATCH = 500;

  async function writeFactCost(table: 'Realizacia' | 'WriteOff', map: Map<string, number>) {
    const updates = [...map.entries()];
    for (let i = 0; i < updates.length; i += BATCH) {
      const slice = updates.slice(i, i + BATCH);
      if (slice.length === 0) continue;
      const values = Prisma.join(
        slice.map(([id, cost]) => Prisma.sql`(${id}::text, ${cost}::double precision)`),
      );
      const tableId = Prisma.raw(`"${table}"`);
      await prisma.$executeRaw`
        UPDATE ${tableId} AS r
        SET "factCost" = v.fc, "factCostSyncedAt" = ${now}::timestamp
        FROM (VALUES ${values}) AS v(id, fc)
        WHERE r.id = v.id
      `;
    }
    return updates.length;
  }

  const realizationsUpdated = await writeFactCost('Realizacia', realizCost);
  const writeOffsUpdated = await writeFactCost('WriteOff', writeOffCost);

  let realizCostTotal = 0;
  for (const v of realizCost.values()) realizCostTotal += v;
  let writeOffCostTotal = 0;
  for (const v of writeOffCost.values()) writeOffCostTotal += v;

  return {
    rowsFetched,
    realizationsUpdated,
    writeOffsUpdated,
    realizCostTotal,
    writeOffCostTotal,
    durationMs: Date.now() - t0,
  };
}

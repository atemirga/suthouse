// Аудит «устаревших» документов: висят в БД (posted), но в 1С распроведены/удалены.
// 1С тянем ШИРЕ окна БД, сравниваем множества Ref_Key — так избегаем TZ-артефакта границ.
import { fetchAllOData, dateFilter, combineFilters, POSTED_FILTER } from '@/lib/odata';
import { prisma } from '@/lib/db';

// Окно БД (Almaty) — что проверяем
const DB_FROM = new Date('2026-04-01T00:00:00+05:00');
const DB_TO = new Date('2026-06-01T00:00:00+05:00');
// Окно 1С — шире на ±несколько дней, чтобы заведомо покрыть те же документы
const ONEC_FROM = new Date('2026-03-20T00:00:00+05:00');
const ONEC_TO = new Date('2026-06-08T00:00:00+05:00');

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

async function fetchFirst(aliases: string[], opts: any): Promise<any[] | null> {
  for (const res of aliases) {
    try { return await fetchAllOData<any>(res, opts); }
    catch (e: any) { if (!/40[34]/.test(String(e.message))) continue; }
  }
  return null;
}

async function oneCPostedSet(aliases: string[]): Promise<Set<string> | null> {
  const f = combineFilters(POSTED_FILTER, dateFilter('Date', 'ge', ONEC_FROM), dateFilter('Date', 'lt', ONEC_TO));
  const rows = await fetchFirst(aliases, { filter: f, select: 'Ref_Key' });
  if (!rows) return null;
  return new Set(rows.map((r) => r.Ref_Key.toLowerCase()));
}

async function main() {
  console.log(`Окно БД: ${DB_FROM.toISOString().slice(0,10)} .. ${DB_TO.toISOString().slice(0,10)}\n`);

  // ── Реализации ──
  {
    const set = await oneCPostedSet(['Document_РасходнаяНакладная', 'Document_РеализацияТоваровУслуг']);
    const db = await prisma.realizacia.findMany({ where: { date: { gte: DB_FROM, lt: DB_TO } }, select: { id: true, number: true, totalAmount: true, date: true } });
    const stale = set ? db.filter((r) => !set.has(r.id.toLowerCase())) : [];
    const sum = stale.reduce((s, r) => s + (r.totalAmount || 0), 0);
    console.log(`РЕАЛИЗАЦИИ: в БД=${db.length}, устаревших(нет в 1С posted)=${stale.length}, сумма=${fmt(sum)} ₸`);
    for (const r of stale.slice(0, 12)) console.log(`   №${r.number} ${r.date.toISOString().slice(0,10)} ${fmt(r.totalAmount)}`);
  }

  // ── Заказы покупателя ──
  {
    const set = await oneCPostedSet(['Document_ЗаказПокупателя']);
    const db = await prisma.orderBuyer.findMany({ where: { date: { gte: DB_FROM, lt: DB_TO } }, select: { id: true, number: true } as any });
    const stale = set ? db.filter((r: any) => !set.has(r.id.toLowerCase())) : [];
    console.log(`\nЗАКАЗЫ ПОКУПАТЕЛЯ: в БД=${db.length}, устаревших=${set ? stale.length : 'OData n/a'}`);
    for (const r of stale.slice(0, 8)) console.log(`   №${(r as any).number}`);
  }

  // ── Закупки ──
  {
    const set = await oneCPostedSet(['Document_ПриходнаяНакладная', 'Document_ПоступлениеТоваровУслуг']);
    const db = await prisma.zakupka.findMany({ where: { date: { gte: DB_FROM, lt: DB_TO } }, select: { id: true, number: true, totalAmount: true } as any });
    const stale = set ? db.filter((r: any) => !set.has(r.id.toLowerCase())) : [];
    const sum = stale.reduce((s, r: any) => s + (r.totalAmount || 0), 0);
    console.log(`\nЗАКУПКИ: в БД=${db.length}, устаревших=${set ? stale.length : 'OData n/a'}, сумма=${fmt(sum)} ₸`);
    for (const r of stale.slice(0, 8)) console.log(`   №${(r as any).number} ${fmt((r as any).totalAmount)}`);
  }

  // ── ДДС: поступления на счёт (выручка деньгами) ──
  {
    const set = await oneCPostedSet(['Document_ПриходНаРасчетныйСчет', 'Document_ПоступлениеНаСчет']);
    const db = await prisma.ddsDocument.findMany({ where: { docType: 'PostuplenieNaSchet', posted: true, date: { gte: DB_FROM, lt: DB_TO } }, select: { id: true, number: true, amount: true } });
    const stale = set ? db.filter((r) => !set.has(r.id.toLowerCase())) : [];
    const sum = stale.reduce((s, r) => s + (r.amount || 0), 0);
    console.log(`\nДДС ПриходНаСчёт: в БД=${db.length}, устаревших=${set ? stale.length : 'OData n/a'}, сумма=${fmt(sum)} ₸`);
    for (const r of stale.slice(0, 8)) console.log(`   №${r.number} ${fmt(r.amount)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('ОШИБКА:', e?.stack || e?.message || e); process.exit(1); });

// Однократный backfill: подтянуть сотрудников и проставить имена в существующих
// Заказах и Реализациях, не перекачивая документы из 1С заново.
import { syncEmployees } from '../src/lib/sync/catalogs';
import { prisma } from '../src/lib/db';

async function main() {
  console.log('Syncing employees from Catalog_Сотрудники...');
  const n = await syncEmployees();
  console.log('Employees synced:', n);

  const emps = await prisma.employee.findMany({ select: { id: true, name: true } });
  const map = new Map(emps.map((e) => [e.id, e.name]));
  console.log('Employees in DB:', emps.length);

  const orders = await prisma.orderBuyer.findMany({
    where: { responsibleId: { not: null }, responsibleName: null },
    select: { id: true, responsibleId: true },
  });
  let upd1 = 0;
  for (const o of orders) {
    const name = map.get(o.responsibleId!);
    if (name) {
      await prisma.orderBuyer.update({ where: { id: o.id }, data: { responsibleName: name } });
      upd1++;
    }
  }
  console.log(`OrderBuyer updated: ${upd1} / ${orders.length}`);

  const reals = await prisma.realizacia.findMany({
    where: { responsibleId: { not: null }, responsibleName: null },
    select: { id: true, responsibleId: true },
  });
  let upd2 = 0;
  for (const r of reals) {
    const name = map.get(r.responsibleId!);
    if (name) {
      await prisma.realizacia.update({ where: { id: r.id }, data: { responsibleName: name } });
      upd2++;
    }
  }
  console.log(`Realizacia updated: ${upd2} / ${reals.length}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

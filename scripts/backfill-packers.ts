// One-shot: backfill OrderBuyer.packerId/packerName из Document_ЗаказПокупателя_ДополнительныеРеквизиты.
import { fetchAllOData } from '../src/lib/odata';
import { prisma } from '../src/lib/db';
import { emptyKey } from '../src/lib/sync/utils';

const PACKER_PROP_GUID = 'd64eea4f-f086-11f0-ae70-c81f66edd58d';

interface AddPropRow { Ref_Key: string; Свойство_Key: string; Значение: string; Значение_Type?: string; }

async function main() {
  const filter = `Свойство_Key eq guid'${PACKER_PROP_GUID}'`;
  console.log('Загружаю доп.реквизиты «Упаковщик» из 1С...');
  const rows = await fetchAllOData<AddPropRow>(
    'Document_ЗаказПокупателя_ДополнительныеРеквизиты',
    { filter },
  );
  console.log(`Получено ${rows.length} строк`);

  const employees = await prisma.employee.findMany({ select: { id: true, name: true } });
  const eMap = new Map(employees.map((e) => [e.id, e.name]));

  let updated = 0; let nomatch = 0;
  for (const p of rows) {
    if (emptyKey(p.Ref_Key) || emptyKey(p.Значение)) continue;
    const packerId = p.Значение;
    const packerName = eMap.get(packerId) || null;
    try {
      const r = await prisma.orderBuyer.update({
        where: { id: p.Ref_Key },
        data: { packerId, packerName },
      });
      if (r) updated++;
    } catch (e: any) {
      if (e.code === 'P2025') { nomatch++; continue; }
      throw e;
    }
  }
  console.log(`Обновлено заказов: ${updated}, не найдено в БД: ${nomatch}`);

  // Статистика
  const stats = await prisma.$queryRaw<{ packerName: string; cnt: bigint }[]>`
    SELECT "packerName", COUNT(*)::bigint AS cnt
    FROM "OrderBuyer"
    WHERE "packerId" IS NOT NULL AND "date" >= '2026-01-01'
    GROUP BY "packerName"
    ORDER BY cnt DESC
  `;
  console.log('\nУпаковщики (с 1 января 2026):');
  for (const s of stats) console.log(`  ${s.packerName}: ${s.cnt}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

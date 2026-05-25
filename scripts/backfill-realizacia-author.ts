// One-shot: заполняет Realizacia.authorId/authorName для уже синканных
// документов, у которых authorName=NULL. Берёт Автор_Key из 1С батчами по 200
// и резолвит имя через User1C/Employee.
//
// Использование: node --env-file=.env --import tsx scripts/backfill-realizacia-author.ts

import { prisma } from '../src/lib/db';
import { fetchAllOData, combineFilters, POSTED_FILTER } from '../src/lib/odata';
import { emptyKey } from '../src/lib/sync/utils';

const RESOURCE_ALIASES = ['Document_РасходнаяНакладная', 'Document_РеализацияТоваровУслуг'];
// Каждый GUID добавляет ~60 символов в URL filter. 30 GUIDs ≈ 1.8KB — безопасно.
const BATCH = 30;

interface Row {
  Ref_Key: string;
  Автор_Key?: string;
}

async function fetchAuthors(refIds: string[]): Promise<Map<string, string>> {
  if (refIds.length === 0) return new Map();
  const filter = combineFilters(
    POSTED_FILTER,
    refIds.map((id) => `Ref_Key eq guid'${id}'`).join(' or '),
  );
  const select = 'Ref_Key,Автор_Key';
  let lastErr: any;
  for (const r of RESOURCE_ALIASES) {
    try {
      const rows = await fetchAllOData<Row>(r, { filter, select });
      const out = new Map<string, string>();
      for (const x of rows) {
        if (x.Автор_Key && !emptyKey(x.Автор_Key)) out.set(x.Ref_Key, x.Автор_Key);
      }
      return out;
    } catch (e: any) {
      lastErr = e;
      if (!/40[34]/.test(String(e.message))) throw e;
    }
  }
  throw lastErr;
}

async function main() {
  const missing = await prisma.realizacia.findMany({
    where: { authorName: null },
    select: { id: true },
  });
  console.log(`[backfill-author] need to backfill: ${missing.length}`);
  if (missing.length === 0) return;

  const [users, employees] = await Promise.all([
    prisma.user1C.findMany({ select: { id: true, name: true } }),
    prisma.employee.findMany({ select: { id: true, name: true } }),
  ]);
  const uMap = new Map(users.map((u) => [u.id, u.name]));
  const eMap = new Map(employees.map((e) => [e.id, e.name]));
  const resolve = (id: string) => uMap.get(id) || eMap.get(id) || null;

  let updated = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const authors = await fetchAuthors(chunk.map((x) => x.id));
    for (const [refId, authorId] of authors.entries()) {
      await prisma.realizacia.update({
        where: { id: refId },
        data: { authorId, authorName: resolve(authorId) },
      });
      updated++;
    }
    console.log(`[backfill-author] ${Math.min(i + BATCH, missing.length)}/${missing.length} processed, ${updated} updated`);
  }
  console.log(`[backfill-author] done. Updated ${updated} of ${missing.length} (missing in 1C: ${missing.length - updated})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

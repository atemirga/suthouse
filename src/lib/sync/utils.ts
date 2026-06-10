import { subDays } from 'date-fns';

export function normalizeName(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim();
}

export function emptyKey(key: string | null | undefined): boolean {
  return !key || key === '00000000-0000-0000-0000-000000000000';
}

export function syncSinceDate(daysBack?: number): Date {
  const days = daysBack ?? Number(process.env.SYNC_DAYS_BACK || 60);
  const rolling = subDays(new Date(), days);
  // Жёсткая нижняя граница: не синкаем документы старше SYNC_SINCE_DATE.
  // Используется для бизнес-логики «учёт ведём только с конкретной даты».
  const hardFloor = process.env.SYNC_SINCE_DATE ? new Date(process.env.SYNC_SINCE_DATE) : null;
  if (hardFloor && !isNaN(hardFloor.getTime()) && hardFloor.getTime() > rolling.getTime()) {
    return hardFloor;
  }
  return rolling;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // 1С отдаёт ISO без таймзоны: "2026-01-15T00:00:00" — это локальное Almaty (UTC+5).
  // Приписываем +05:00, чтобы получить корректный UTC-момент в БД.
  // Если в строке уже есть TZ-суффикс — оставляем как есть.
  const hasTz = s.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(s);
  const d = new Date(hasTz ? s : s + '+05:00');
  if (isNaN(d.getTime())) return null;
  return d;
}

export function num(v: any): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

// Ref_Key'и, которые лежат в БД (внутри окна синка), но отсутствуют в свежем
// posted-наборе из 1С — значит, документ в 1С распровели или пометили на удаление.
// Синки тянут только Posted=true, поэтому такие документы выпадают из фида и иначе
// зависают в БД навсегда, завышая отчёты. Их нужно удалить.
export function computeStaleIds(dbIds: string[], fetchedIds: Iterable<string>): string[] {
  const fresh = new Set(fetchedIds);
  return dbIds.filter((id) => !fresh.has(id));
}

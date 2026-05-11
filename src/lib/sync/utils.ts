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
  return subDays(new Date(), days);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  // 1С отдаёт ISO без таймзоны: "2026-01-15T00:00:00"
  // Интерпретируем как Asia/Almaty (UTC+5) → конвертируем в UTC
  const d = new Date(s + (s.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  if (isNaN(d.getTime())) return null;
  return d;
}

export function num(v: any): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

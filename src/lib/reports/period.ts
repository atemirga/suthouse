import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
  endOfWeek,
  endOfMonth,
  format,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  parseISO,
} from 'date-fns';

export type Granularity = 'day' | 'week' | 'month';

export interface PeriodInput {
  from: Date | string;
  to: Date | string;
  granularity?: Granularity;
}

export interface ResolvedPeriod {
  from: Date;
  to: Date;
  granularity: Granularity;
  columns: string[]; // упорядоченные ключи периодов
  bucketOf: (d: Date) => string;
}

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : parseISO(d);
}

export function resolvePeriod(input: PeriodInput): ResolvedPeriod {
  const from = startOfDay(toDate(input.from));
  const to = endOfDay(toDate(input.to));
  const granularity = input.granularity || 'month';

  let columns: string[];
  let bucketOf: (d: Date) => string;

  if (granularity === 'day') {
    const days = eachDayOfInterval({ start: from, end: to });
    columns = days.map((d) => format(d, 'yyyy-MM-dd'));
    bucketOf = (d) => format(d, 'yyyy-MM-dd');
  } else if (granularity === 'week') {
    const weeks = eachWeekOfInterval({ start: from, end: to }, { weekStartsOn: 1 });
    columns = weeks.map((d) => format(d, 'yyyy-ww'));
    bucketOf = (d) => format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-ww');
  } else {
    const months = eachMonthOfInterval({ start: from, end: to });
    columns = months.map((d) => format(d, 'yyyy-MM'));
    bucketOf = (d) => format(d, 'yyyy-MM');
  }

  return { from, to, granularity, columns, bucketOf };
}

export function emptyMatrix(columns: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const c of columns) o[c] = 0;
  return o;
}

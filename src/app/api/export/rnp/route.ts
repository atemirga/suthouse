import { NextRequest } from 'next/server';
import { buildRnp } from '@/lib/reports/rnp';
import { format } from 'date-fns';
import { toCsv, csvResponse } from '@/lib/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const r = await buildRnp({
    status: url.searchParams.get('status') || undefined,
    responsible: url.searchParams.get('responsible') || undefined,
    kontragentId: url.searchParams.get('kontragent') || undefined,
    from: url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : undefined,
    to: url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : undefined,
  });

  const headers = ['Дата', '№', 'Контрагент', 'Менеджер', 'Статус', 'Сумма', 'Оплачено', 'Отгружено', 'Долг по отгрузке', 'Дней в работе', 'Комментарий'];
  const rows = r.rows.map((row) => [
    format(row.date, 'dd.MM.yyyy'),
    row.number,
    row.kontragentName || '',
    row.responsibleName || '',
    row.status || '',
    Math.round(row.totalAmount),
    Math.round(row.paidAmount),
    Math.round(row.shippedAmount),
    Math.round(row.shipmentLeft),
    row.daysInWork,
    row.comment || '',
  ]);

  return csvResponse(`RNP_${format(new Date(), 'yyyyMMdd')}.csv`, toCsv(headers, rows));
}

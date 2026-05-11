import { buildRnp } from '@/lib/reports/rnp';
import { format } from 'date-fns';
import RnpFiltersBar from '@/components/RnpFiltersBar';
import ExportButton from '@/components/ExportButton';

export const dynamic = 'force-dynamic';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

interface Props {
  searchParams: { status?: string; responsible?: string; kontragent?: string; from?: string; to?: string };
}

export default async function RnpPage({ searchParams }: Props) {
  const report = await buildRnp({
    status: searchParams.status,
    responsible: searchParams.responsible,
    kontragentId: searchParams.kontragent,
    from: searchParams.from ? new Date(searchParams.from) : undefined,
    to: searchParams.to ? new Date(searchParams.to) : undefined,
  });

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">РНП — Заказы в работе</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {report.summary.totalOrders} заказов с остатком по отгрузке или оплате
          </p>
        </div>
        <ExportButton endpoint="/api/export/rnp" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Сумма заказов</div>
          <div className="kpi-value">{fmt(report.summary.totalAmount)} <span className="text-base text-gray-500">₸</span></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Получено оплат</div>
          <div className="kpi-value">{fmt(report.summary.totalPaid)} <span className="text-base text-gray-500">₸</span></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Авансы (оплачено − отгружено)</div>
          <div className="kpi-value text-amber-700">{fmt(report.summary.advancesReceived)} <span className="text-base text-gray-500">₸</span></div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Ожидаемая выручка</div>
          <div className="kpi-value text-green-700">{fmt(report.summary.expectedRevenue)} <span className="text-base text-gray-500">₸</span></div>
        </div>
      </div>

      <RnpFiltersBar />

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th>Дата</th>
              <th>№</th>
              <th>Контрагент</th>
              <th>Менеджер</th>
              <th>Статус</th>
              <th className="text-right">Сумма</th>
              <th className="text-right">Оплачено</th>
              <th className="text-right">Отгружено</th>
              <th className="text-right">Долг по отгрузке</th>
              <th className="text-right">Дней</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr><td colSpan={10} className="text-center text-gray-500 py-8">Нет заказов с такими фильтрами</td></tr>
            )}
            {report.rows.map((r) => (
              <tr key={r.id}>
                <td>{format(r.date, 'dd.MM.yyyy')}</td>
                <td className="text-xs">{r.number}</td>
                <td>{r.kontragentName || '—'}</td>
                <td className="text-xs">{r.responsibleName || '—'}</td>
                <td>
                  <span className={
                    r.status === 'Открыт' ? 'inline-block px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800'
                    : r.status?.includes('абот') ? 'inline-block px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-800'
                    : 'inline-block px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700'
                  }>
                    {r.status || '—'}
                  </span>
                </td>
                <td className="num">{fmt(r.totalAmount)}</td>
                <td className="num">{fmt(r.paidAmount)}</td>
                <td className="num">{fmt(r.shippedAmount)}</td>
                <td className="num">{fmt(r.shipmentLeft)}</td>
                <td className="num">{r.daysInWork}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

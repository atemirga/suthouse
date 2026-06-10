import VypiskaClient from '@/components/VypiskaClient';

export const dynamic = 'force-dynamic';

export default function VypiskaPage() {
  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Сверка выписки Kaspi</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Загрузите выписку по расчётному счёту Kaspi (Excel/CSV). Сверяем дневные продажи
          «Продажи с Kaspi.kz» с оплатами клиентов в 1С и подсвечиваем расхождения. Период
          берётся из самой выписки.
        </p>
      </div>
      <VypiskaClient />
    </div>
  );
}

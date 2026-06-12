import VypiskaClient from '@/components/VypiskaClient';

export const dynamic = 'force-dynamic';

export default function VypiskaPage() {
  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Сверка выписки</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Загрузите любую банковскую выписку (Excel/CSV или PDF) — Kaspi Pay, Kaspi Gold,
          Halyk POS и др. Формат и поступления определяются автоматически; счёт 1С для сверки
          подбирается по формату и его можно поменять. Период берётся из самой выписки.
        </p>
      </div>
      <VypiskaClient />
    </div>
  );
}

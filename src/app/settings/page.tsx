import Link from 'next/link';
import { prisma } from '@/lib/db';
import { IconList, IconClock, IconBuilding, IconRefresh, IconSync, IconArrowRight } from '@/components/Icons';

export const dynamic = 'force-dynamic';

const sections = [
  {
    href: '/settings/mapping',
    title: 'Маппинг статей ДДС',
    desc: 'Свяжите статьи ДДС с категориями ОПиУ (выручка, ФОТ, аренда и т.д.). От этого зависит корректность отчёта о прибылях.',
    icon: IconList,
  },
  {
    href: '/settings/accruals',
    title: 'Правила распределения (Accrual)',
    desc: 'Например: годовая страховка размазывается на 12 месяцев в ОПиУ, а не отражается в одном месяце оплаты.',
    icon: IconClock,
  },
  {
    href: '/settings/fixed-assets',
    title: 'Основные средства',
    desc: 'Линейная амортизация ОС: ежемесячно стоимость / срок включается в ОПиУ как амортизация.',
    icon: IconBuilding,
  },
  {
    href: '/settings/adjustments',
    title: 'Ручные корректировки',
    desc: 'Точечные правки ОПиУ по месяцам и категориям. Используйте для ручных доначислений или исправлений.',
    icon: IconRefresh,
  },
  {
    href: '/settings/sync',
    title: 'Синхронизация с 1С',
    desc: 'Статус, лог запусков и ручной запуск синхронизации с 1С:УНФ через OData.',
    icon: IconSync,
  },
];

export default async function SettingsIndex() {
  const unmapped = await prisma.ddsArticle.count({ where: { isFolder: false, opiuCategory: null } });
  return (
    <div className="space-y-5 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Настройки</h1>
        <p className="text-sm text-gray-500 mt-0.5">Маппинг, правила распределения, амортизация ОС и синхронизация</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              className="group panel p-4 hover:border-brand-400 hover:shadow-sm transition-all flex gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center group-hover:bg-brand-100">
                <Icon width={20} height={20} />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900 flex items-center gap-2">
                  {s.title}
                  <IconArrowRight width={14} height={14} className="text-gray-400 group-hover:text-brand-600 transition-colors" />
                </div>
                <div className="text-sm text-gray-500 mt-1">{s.desc}</div>
                {s.href === '/settings/mapping' && unmapped > 0 && (
                  <div className="text-xs text-amber-700 mt-2 inline-flex items-center gap-1 bg-amber-50 px-2 py-1 rounded">
                    ⚠ {unmapped} статей без категории
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

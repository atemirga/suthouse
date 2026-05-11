import { IconStar, IconInfo, IconArrowRight } from '@/components/Icons';
import Link from 'next/link';

export const dynamic = 'force-static';

type FavoriteReport = {
  title: string;
  description: string;
  href: string | null;
  group: 'Деньги' | 'Продажи' | 'Анализ' | 'Склад' | 'Покупатели';
  available: boolean;
};

const FAVORITES: FavoriteReport[] = [
  {
    title: 'ДДС-Касса',
    description: 'Движение денежных средств по кассе: поступления и выплаты по статьям.',
    href: '/dds',
    group: 'Деньги',
    available: true,
  },
  {
    title: 'ДДС-Отчет',
    description: 'Полный отчёт по движению денежных средств (банк + касса).',
    href: '/dds',
    group: 'Деньги',
    available: true,
  },
  {
    title: 'Документы по банку и кассе',
    description: 'Список первичных документов по расчётным счетам и кассам.',
    href: null,
    group: 'Деньги',
    available: false,
  },
  {
    title: 'Расходы',
    description: 'Структура расходов по статьям. Раздел ОПиУ — Расходы.',
    href: '/opiu',
    group: 'Деньги',
    available: true,
  },
  {
    title: 'Воронка продаж',
    description: 'Конверсия сделок по этапам: новые → в работе → выигранные.',
    href: null,
    group: 'Продажи',
    available: false,
  },
  {
    title: 'Планы продаж',
    description: 'План продаж по периодам, менеджерам и категориям.',
    href: null,
    group: 'Продажи',
    available: false,
  },
  {
    title: 'План-фактный анализ продаж',
    description: 'Сравнение плановых и фактических показателей продаж.',
    href: null,
    group: 'Продажи',
    available: false,
  },
  {
    title: 'Автоматические скидки',
    description: 'Скидки, применённые автоматически по условиям продаж.',
    href: null,
    group: 'Продажи',
    available: false,
  },
  {
    title: 'Продажи по категориям по месяцам',
    description: 'Динамика продаж по группам номенклатуры в разрезе месяцев.',
    href: null,
    group: 'Анализ',
    available: false,
  },
  {
    title: 'Продажи SKU менеджер',
    description: 'Продажи в разрезе SKU и менеджера: топ-позиции, неликвиды.',
    href: null,
    group: 'Анализ',
    available: false,
  },
  {
    title: 'ABC-анализ продаж',
    description: 'Классификация номенклатуры на группы A/B/C по выручке.',
    href: null,
    group: 'Анализ',
    available: false,
  },
  {
    title: 'Отчет по упаковщикам ABC',
    description: 'Производительность упаковщиков с группировкой по ABC.',
    href: null,
    group: 'Анализ',
    available: false,
  },
  {
    title: 'Остатки товаров',
    description: 'Остатки по складам с детализацией по характеристикам и партиям.',
    href: null,
    group: 'Склад',
    available: false,
  },
  {
    title: 'Дебиторская задолженность',
    description: 'Задолженность покупателей. Раздел РНП — Заказы в работе.',
    href: '/rnp',
    group: 'Покупатели',
    available: true,
  },
  {
    title: 'Заказы покупателей менеджера',
    description: 'Активные заказы покупателей, сгруппированные по менеджеру.',
    href: '/rnp',
    group: 'Покупатели',
    available: true,
  },
];

const GROUP_ORDER: FavoriteReport['group'][] = ['Деньги', 'Продажи', 'Анализ', 'Склад', 'Покупатели'];

export default function FavoritesPage() {
  const totalAvailable = FAVORITES.filter((r) => r.available).length;
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: FAVORITES.filter((r) => r.group === g),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <IconStar className="text-amber-500" /> Избранное
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Список избранных отчётов из 1С:УНФ. {totalAvailable} из {FAVORITES.length} уже доступны в проекте;
          остальные запланированы и в данный момент рассчитываются непосредственно в 1С.
        </p>
      </div>

      <div className="hint">
        <IconInfo className="hint-icon" />
        <div className="text-sm">
          <b>Как пользоваться.</b> Доступные отчёты открываются по клику и используют данные из последней
          синхронизации с 1С (каждые 15 минут). Отчёты со статусом «в 1С» — это закладки на штатные отчёты
          1С:УНФ; в проект они будут перенесены по мере необходимости.
        </div>
      </div>

      <div className="space-y-5">
        {grouped.map(({ group, items }) => (
          <div key={group} className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold px-1">{group}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map((r) => {
                const card = (
                  <div
                    className={
                      'panel p-4 h-full flex flex-col gap-2 transition-colors ' +
                      (r.available ? 'hover:bg-brand-50 hover:border-brand-300 cursor-pointer' : 'opacity-75')
                    }
                  >
                    <div className="flex items-start gap-2">
                      <IconStar className="text-amber-400 shrink-0 mt-0.5" width={16} height={16} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 text-sm leading-tight">{r.title}</div>
                      </div>
                      {r.available ? (
                        <IconArrowRight className="text-gray-400 shrink-0" width={16} height={16} />
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                          в 1С
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 leading-snug">{r.description}</div>
                  </div>
                );
                return r.available && r.href ? (
                  <Link key={r.title} href={r.href} className="block">
                    {card}
                  </Link>
                ) : (
                  <div key={r.title}>{card}</div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

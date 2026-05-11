'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useMemo } from 'react';
import {
  IconHome,
  IconOpiu,
  IconDds,
  IconRnp,
  IconSettings,
  IconLogout,
  IconWarning,
  IconCash,
  IconCart,
  IconBox,
  IconCoins,
  IconUsers,
  IconChevronDown,
  IconTrend,
  IconWallet,
  IconBuilding,
  IconPie,
} from './Icons';

type NavItem = { href: string; label: string; icon?: (p: any) => JSX.Element; hint?: string; soon?: boolean };
type NavGroup = { id: string; label: string; icon: (p: any) => JSX.Element; items: NavItem[] };

const groups: NavGroup[] = [
  {
    id: 'main',
    label: 'Главная',
    icon: IconHome,
    items: [
      { href: '/', label: 'Дашборд', icon: IconHome, hint: 'Сводка ключевых показателей' },
    ],
  },
  {
    id: 'money',
    label: 'Деньги',
    icon: IconWallet,
    items: [
      { href: '/dds', label: 'ДДС-Отчёт', icon: IconDds, hint: 'Операционная / Инвестиционная / Финансовая' },
      { href: '/dds/by-kassa', label: 'ДДС по кассам', icon: IconCash, hint: 'Остатки и обороты по каждой кассе' },
      { href: '/payments', label: 'Платежи', icon: IconCoins, hint: 'Реестр банковских и кассовых платежей' },
    ],
  },
  {
    id: 'profit',
    label: 'Прибыль',
    icon: IconOpiu,
    items: [
      { href: '/opiu', label: 'ОПиУ (P&L)', icon: IconOpiu, hint: 'Прибыли и убытки' },
      { href: '/expenses', label: 'Структура расходов', icon: IconPie, hint: 'Расходы по категориям' },
      { href: '/discounts', label: 'Скидки', icon: IconTrend, hint: 'Предоставленные скидки' },
    ],
  },
  {
    id: 'sales',
    label: 'Продажи',
    icon: IconCart,
    items: [
      { href: '/sales/abc', label: 'ABC-анализ', icon: IconCart, hint: 'A/B/C по выручке и марже' },
      { href: '/sales/by-category', label: 'По категориям', icon: IconCart, hint: 'Категории номенклатуры' },
      { href: '/sales/by-sku', label: 'По SKU и менеджерам', icon: IconCart, hint: 'Позиции × менеджер' },
      { href: '/sales/funnel', label: 'Воронка продаж', icon: IconUsers, hint: 'По источникам привлечения' },
      { href: '/sales/by-manager', label: 'Заказы менеджеров', icon: IconUsers, hint: 'Кто что выполнил' },
      { href: '/sales/plans', label: 'Планы продаж', icon: IconTrend, hint: 'Установка целевых планов' },
      { href: '/sales/plan-fact', label: 'План-факт анализ', icon: IconTrend, hint: 'Сравнение план vs факт' },
    ],
  },
  {
    id: 'inventory',
    label: 'Запасы',
    icon: IconBox,
    items: [
      { href: '/inventory/balances', label: 'Остатки товаров', icon: IconBox, hint: 'На дату, по складам' },
    ],
  },
  {
    id: 'settlements',
    label: 'Расчёты',
    icon: IconCoins,
    items: [
      { href: '/receivables', label: 'Дебиторка', icon: IconCoins, hint: 'Долги с разбивкой по возрасту (AR Aging)' },
      { href: '/payables', label: 'Кредиторка', icon: IconCoins, hint: 'Наши долги поставщикам' },
    ],
  },
  {
    id: 'ops',
    label: 'Операционные',
    icon: IconBuilding,
    items: [
      { href: '/rnp', label: 'РНП — Заказы в работе', icon: IconRnp, hint: 'Заказы покупателей' },
      { href: '/packers', label: 'Упаковщики', icon: IconUsers, hint: 'Отчёт по упаковщикам ABC', soon: true },
      { href: '/anomalies', label: 'Аномалии', icon: IconWarning, hint: 'Ошибки данных, подозрительные документы' },
    ],
  },
  {
    id: 'settings',
    label: 'Настройки',
    icon: IconSettings,
    items: [
      { href: '/settings', label: 'Все настройки', icon: IconSettings, hint: 'Маппинг, accrual, ОС, синк' },
    ],
  },
];

export default function Sidebar({ user }: { user: string }) {
  const pathname = usePathname();

  // Какие группы развёрнуты по умолчанию — те, в которых активный путь, и Главная/Деньги/Расчёты.
  const initialOpen = useMemo(() => {
    const open = new Set<string>(['main', 'money', 'profit', 'sales', 'inventory', 'settlements', 'ops']);
    for (const g of groups) {
      if (g.items.some((it) => isActive(pathname, it.href))) open.add(g.id);
    }
    return open;
  }, [pathname]);

  const [openGroups, setOpenGroups] = useState<Set<string>>(initialOpen);

  function toggle(id: string) {
    const next = new Set(openGroups);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpenGroups(next);
  }

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col sticky top-0 h-screen">
      <div className="px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold shadow-sm">
            S
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 leading-tight">SUT HOUSE</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Финансы</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {groups.map((g) => {
          const isSingle = g.items.length === 1;
          if (isSingle) {
            const it = g.items[0];
            return (
              <NavLink key={g.id} item={it} pathname={pathname} forceIcon={g.icon} />
            );
          }
          const opened = openGroups.has(g.id);
          const hasActive = g.items.some((it) => isActive(pathname, it.href));
          const GIcon = g.icon;
          return (
            <div key={g.id}>
              <button
                onClick={() => toggle(g.id)}
                className={
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-colors ' +
                  (hasActive ? 'text-brand-700' : 'text-gray-500 hover:text-gray-700')
                }
              >
                <GIcon width={12} height={12} className="opacity-70" />
                <span className="flex-1 text-left">{g.label}</span>
                <IconChevronDown
                  width={12}
                  height={12}
                  className={'transition-transform ' + (opened ? '' : '-rotate-90')}
                />
              </button>
              {opened && (
                <div className="mt-0.5 mb-1.5 space-y-0.5">
                  {g.items.map((it) => (
                    <NavLink key={it.href} item={it} pathname={pathname} indented />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-gray-200 space-y-2">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center uppercase">
            {user.slice(0, 2)}
          </div>
          <div className="text-xs">
            <div className="text-gray-700 font-medium">{user}</div>
            <div className="text-gray-400 text-[10px]">Администратор</div>
          </div>
        </div>
        <form method="POST" action="/api/auth/logout">
          <button className="w-full flex items-center gap-2 text-xs px-3 py-2 bg-gray-50 hover:bg-red-50 hover:text-red-700 rounded-lg text-gray-600 transition-colors">
            <IconLogout width={14} height={14} />
            <span>Выйти</span>
          </button>
        </form>
        <div className="text-[10px] text-gray-400 px-2 pt-1">v0.3 · 1С:УНФ KZ 1.6</div>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function NavLink({
  item,
  pathname,
  indented,
  forceIcon,
}: {
  item: NavItem;
  pathname: string;
  indented?: boolean;
  forceIcon?: (p: any) => JSX.Element;
}) {
  const active = isActive(pathname, item.href);
  const Icon = forceIcon || item.icon;

  if (item.soon) {
    return (
      <div
        title={(item.hint || item.label) + ' · скоро'}
        className={
          'flex items-center gap-2 rounded-lg text-sm transition-colors text-gray-400 cursor-not-allowed ' +
          (indented ? 'pl-7 pr-2 py-1.5' : 'px-2.5 py-2')
        }
      >
        {Icon && <Icon width={14} height={14} className="shrink-0 opacity-50" />}
        <span className="flex-1 truncate">{item.label}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wider">скоро</span>
      </div>
    );
  }
  return (
    <Link
      href={item.href}
      title={item.hint}
      className={
        'group flex items-center gap-2 rounded-lg text-sm transition-colors relative ' +
        (indented ? 'pl-7 pr-2 py-1.5' : 'px-2.5 py-2 font-medium') +
        ' ' +
        (active
          ? 'bg-brand-50 text-brand-700 font-semibold'
          : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900')
      }
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-brand-600 rounded-r" />}
      {Icon && (
        <Icon
          width={14}
          height={14}
          className={'shrink-0 transition-colors ' + (active ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-700')}
        />
      )}
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconDashboard,
  IconOpiu,
  IconDds,
  IconRnp,
  IconSettings,
  IconLogout,
  IconWarning,
} from './Icons';

const navItems = [
  { href: '/', label: 'Дашборд', icon: IconDashboard, hint: 'Сводка KPI и графики' },
  { href: '/opiu', label: 'ОПиУ', icon: IconOpiu, hint: 'Прибыли и убытки (P&L)' },
  { href: '/dds', label: 'ДДС', icon: IconDds, hint: 'Движение денежных средств' },
  { href: '/rnp', label: 'РНП', icon: IconRnp, hint: 'Заказы в работе' },
  { href: '/anomalies', label: 'Аномалии', icon: IconWarning, hint: 'Ошибки данных, опечатки, подозрительные документы' },
  { href: '/settings', label: 'Настройки', icon: IconSettings, hint: 'Маппинг, accrual, ОС' },
];

export default function Sidebar({ user }: { user: string }) {
  const pathname = usePathname();
  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside className="w-60 bg-white border-r border-gray-200 flex flex-col sticky top-0 h-screen">
      <div className="px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold">
            S
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900 leading-tight">SUT HOUSE</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Финансы</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((it) => {
          const active = isActive(it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              title={it.hint}
              className={
                'group flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors relative ' +
                (active
                  ? 'bg-brand-50 text-brand-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900')
              }
            >
              {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-brand-600 rounded-r" />}
              <Icon
                className={
                  'shrink-0 transition-colors ' +
                  (active ? 'text-brand-600' : 'text-gray-400 group-hover:text-gray-700')
                }
              />
              <span>{it.label}</span>
            </Link>
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
        <div className="text-[10px] text-gray-400 px-2 pt-1">v0.2 · 1С:УНФ KZ 1.6</div>
      </div>
    </aside>
  );
}

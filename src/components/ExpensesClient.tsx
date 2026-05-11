'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PieBreakdown } from './Charts';
import { IconChevronDown } from './Icons';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#a855f7', '#14b8a6'];

export default function ExpensesClient({ initial }: { initial: any }) {
  const sp = useSearchParams();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetch('/api/expenses?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function toggle(c: string) {
    const n = new Set(opened); if (n.has(c)) n.delete(c); else n.add(c); setOpened(n);
  }

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const pieData = data.rows.map((r: any) => ({ name: r.label, value: r.amount }));

  return (
    <div className="space-y-5">
      {loading && <div className="text-xs text-gray-500">Обновляю данные…</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="panel lg:col-span-1">
          <div className="panel-header"><div className="panel-title">Доли категорий</div></div>
          <div className="p-3">
            <PieBreakdown data={pieData} height={260} />
          </div>
        </div>

        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <div className="panel-title">Детализация — кликните для разворота</div>
            <div className="text-sm text-gray-500">Всего: <span className="font-semibold text-gray-900">{fmt(data.total)} ₸</span></div>
          </div>
          <div className="overflow-auto">
            <table className="report">
              <thead>
                <tr>
                  <th>Категория</th>
                  <th className="text-right">Сумма</th>
                  <th className="text-right w-40">Доля</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any, i: number) => {
                  const isOpen = opened.has(r.category);
                  const c = COLORS[i % COLORS.length];
                  return (
                    <>
                      <tr key={r.category} className="cursor-pointer" onClick={() => toggle(r.category)}>
                        <td>
                          <div className="flex items-center gap-2">
                            <IconChevronDown width={12} height={12} className={'text-gray-400 transition-transform ' + (isOpen ? '' : '-rotate-90')} />
                            <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                            <span className="font-medium">{r.label}</span>
                            <span className="text-[10px] text-gray-400">({r.articles.length} ст.)</span>
                          </div>
                        </td>
                        <td className="num font-semibold">{fmt(r.amount)}</td>
                        <td className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="h-1.5 w-24 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${r.share}%`, background: c }} />
                            </div>
                            <span className="text-xs text-gray-500 w-12">{r.share.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                      {isOpen && r.articles.map((a: any) => (
                        <tr key={a.name} className="bg-gray-50/50">
                          <td className="text-xs text-gray-600 pl-10">{a.name}</td>
                          <td className="num text-xs">{fmt(a.amount)}</td>
                          <td></td>
                        </tr>
                      ))}
                    </>
                  );
                })}
                {data.rows.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-gray-500 py-8">Нет данных за период</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

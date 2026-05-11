'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

interface Item {
  id: string;
  month: string;
  category: string;
  amount: number;
  comment: string | null;
  createdAt: Date;
}

const CATEGORIES = [
  'revenue', 'cogs', 'var_expenses', 'payroll', 'rent', 'marketing', 'admin',
  'logistics', 'taxes', 'interest', 'other_income', 'other_expense',
];

const CATEGORY_LABELS: Record<string, string> = {
  revenue: 'Выручка', cogs: 'Себестоимость', var_expenses: 'Перем. расходы',
  payroll: 'ФОТ', rent: 'Аренда', marketing: 'Маркетинг', admin: 'Админ.',
  logistics: 'Логистика', taxes: 'Налоги', interest: 'Проценты',
  other_income: 'Прочие доходы', other_expense: 'Прочие расходы',
};

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0, signDisplay: 'always' }).format(n);
}

export default function AdjustmentsClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [category, setCategory] = useState('payroll');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch('/api/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, category, amount: Number(amount), comment }),
      });
      if (r.ok) { setAmount(''); setComment(''); router.refresh(); }
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Удалить корректировку?')) return;
    await fetch('/api/adjustments?id=' + id, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white border border-gray-200 rounded-lg p-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Месяц</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Категория</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm">
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Сумма (+/−)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div className="md:col-span-2 flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Комментарий</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button disabled={saving} className="md:col-span-5 md:w-auto px-3 py-1.5 bg-brand-600 text-white text-sm rounded hover:bg-brand-700 disabled:opacity-50">Добавить</button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-auto">
        <table className="report">
          <thead>
            <tr><th>Месяц</th><th>Категория</th><th className="text-right">Сумма</th><th>Комментарий</th><th>Создано</th><th></th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="text-center text-gray-500 py-6">Корректировок нет</td></tr>}
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.month}</td>
                <td>{CATEGORY_LABELS[i.category] || i.category}</td>
                <td className="num" style={{ color: i.amount >= 0 ? '#15803d' : '#b91c1c' }}>{fmt(i.amount)}</td>
                <td className="text-xs text-gray-600 max-w-md truncate">{i.comment || ''}</td>
                <td className="text-xs text-gray-400">{format(i.createdAt, 'dd.MM.yyyy HH:mm')}</td>
                <td className="text-right"><button onClick={() => remove(i.id)} className="text-red-600 text-xs hover:underline">Удалить</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

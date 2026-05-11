'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Item {
  id: string;
  name: string;
  cost: number;
  usefulMonths: number;
  startDate: string;
  method: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

export default function FixedAssetsClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [usefulMonths, setUsefulMonths] = useState('60');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch('/api/fixed-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cost, usefulMonths, startDate }),
      });
      if (r.ok) {
        setName(''); setCost(''); setUsefulMonths('60');
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить ОС?')) return;
    await fetch('/api/fixed-assets?id=' + id, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white border border-gray-200 rounded-lg p-3 items-end">
        <div className="md:col-span-2 flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Название</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Стоимость, ₸</label>
          <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} required className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Срок, мес</label>
          <input type="number" value={usefulMonths} onChange={(e) => setUsefulMonths(e.target.value)} required className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Дата ввода</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>
        <button disabled={saving} className="md:col-span-5 md:w-auto px-3 py-1.5 bg-brand-600 text-white text-sm rounded hover:bg-brand-700 disabled:opacity-50">Добавить ОС</button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th>Название</th>
              <th className="text-right">Стоимость</th>
              <th className="text-right">Срок (мес)</th>
              <th className="text-right">Аморт./мес</th>
              <th>Ввод в эксплуатацию</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="text-center text-gray-500 py-6">ОС не добавлены</td></tr>}
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="num">{fmt(i.cost)}</td>
                <td className="num">{i.usefulMonths}</td>
                <td className="num">{fmt(i.cost / Math.max(1, i.usefulMonths))}</td>
                <td>{i.startDate}</td>
                <td className="text-right">
                  <button onClick={() => remove(i.id)} className="text-red-600 text-xs hover:underline">Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Rule {
  id: string;
  articleId: string;
  articleName: string;
  months: number;
  method: string;
}

interface Article { id: string; name: string }

export default function AccrualsClient({ rules, articles }: { rules: Rule[]; articles: Article[] }) {
  const router = useRouter();
  const [articleId, setArticleId] = useState('');
  const [months, setMonths] = useState(12);
  const [method, setMethod] = useState('equal');
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!articleId) return;
    setSaving(true);
    try {
      const r = await fetch('/api/accruals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId, months, method }),
      });
      if (r.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить правило?')) return;
    await fetch('/api/accruals?id=' + id, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex flex-col flex-1 min-w-[240px]">
          <label className="text-xs text-gray-500 mb-0.5">Статья ДДС</label>
          <select value={articleId} onChange={(e) => setArticleId(e.target.value)} required className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">— выбрать —</option>
            {articles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Месяцев</label>
          <input type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Метод</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="equal">Равномерно</option>
          </select>
        </div>
        <button disabled={saving} className="px-3 py-1.5 bg-brand-600 text-white text-sm rounded hover:bg-brand-700 disabled:opacity-50">Добавить</button>
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-auto">
        <table className="report">
          <thead>
            <tr><th>Статья</th><th>Месяцев</th><th>Метод</th><th></th></tr>
          </thead>
          <tbody>
            {rules.length === 0 && <tr><td colSpan={4} className="text-center text-gray-500 py-6">Правил нет</td></tr>}
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.articleName}</td>
                <td>{r.months}</td>
                <td>{r.method === 'equal' ? 'Равномерно' : r.method}</td>
                <td className="text-right">
                  <button onClick={() => remove(r.id)} className="text-red-600 text-xs hover:underline">Удалить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

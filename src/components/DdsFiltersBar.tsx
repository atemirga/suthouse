'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';

interface Item { id: string; name: string }

export default function DdsFiltersBar({
  kassy,
  banks,
  articles,
}: {
  kassy: Item[];
  banks: Item[];
  articles: Item[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [kassa, setKassa] = useState(sp.get('kassa') || '');
  const [account, setAccount] = useState(sp.get('account') || '');
  const [article, setArticle] = useState(sp.get('article') || '');
  const [q, setQ] = useState(sp.get('q') || '');

  function apply() {
    const params = new URLSearchParams(sp.toString());
    if (kassa) params.set('kassa', kassa); else params.delete('kassa');
    if (account) params.set('account', account); else params.delete('account');
    if (article) params.set('article', article); else params.delete('article');
    if (q) params.set('q', q); else params.delete('q');
    router.push(`${pathname}?${params.toString()}`);
  }

  function reset() {
    setKassa(''); setAccount(''); setArticle(''); setQ('');
    const params = new URLSearchParams(sp.toString());
    ['kassa', 'account', 'article', 'q'].forEach((k) => params.delete(k));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="panel p-3 flex flex-wrap items-end gap-3">
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-medium">Касса</label>
        <select value={kassa} onChange={(e) => setKassa(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm min-w-[160px] bg-white">
          <option value="">— все —</option>
          {kassy.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-medium">Расчётный счёт</label>
        <select value={account} onChange={(e) => setAccount(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm min-w-[160px] bg-white">
          <option value="">— все —</option>
          {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-medium">Статья ДДС</label>
        <select value={article} onChange={(e) => setArticle(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm min-w-[220px] bg-white">
          <option value="">— все —</option>
          {articles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col flex-1 min-w-[180px]">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-medium">Поиск по комментарию</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" placeholder="Например: «доставка»" />
      </div>
      <button onClick={apply} className="btn btn-primary">Применить</button>
      <button onClick={reset} className="btn btn-secondary">Сброс</button>
    </div>
  );
}

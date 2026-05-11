'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { IconRefresh, IconCheck, IconWarning, IconInfo, IconX } from './Icons';

interface Article {
  id: string;
  name: string;
  isFolder: boolean;
  opiuCategory: string | null;
  ddsSection: string | null;
  turnover: number;
  docCount: number;
}

const OPIU_OPTIONS = [
  { value: '', label: '— не задано —', group: '' },
  { value: 'revenue', label: 'Выручка', group: 'Доходы' },
  { value: 'other_income', label: 'Прочие доходы', group: 'Доходы' },
  { value: 'cogs', label: 'Себестоимость продаж', group: 'Расходы' },
  { value: 'var_expenses', label: 'Переменные расходы', group: 'Расходы' },
  { value: 'payroll', label: 'ФОТ (зарплата)', group: 'Опер. расходы' },
  { value: 'rent', label: 'Аренда', group: 'Опер. расходы' },
  { value: 'marketing', label: 'Маркетинг', group: 'Опер. расходы' },
  { value: 'admin', label: 'Административные', group: 'Опер. расходы' },
  { value: 'logistics', label: 'Логистика', group: 'Опер. расходы' },
  { value: 'taxes', label: 'Налоги', group: 'Опер. расходы' },
  { value: 'interest', label: 'Проценты по кредитам', group: 'Финансы' },
  { value: 'other_expense', label: 'Прочие расходы', group: 'Прочее' },
  { value: 'capex', label: 'Покупка ОС (CAPEX)', group: 'Инвестиции' },
  { value: 'financing_in', label: 'Финансирование (приход)', group: 'Финансы' },
  { value: 'financing_out', label: 'Финансирование (расход)', group: 'Финансы' },
  { value: 'transfer', label: 'Перемещение (исключить)', group: 'Прочее' },
];

const DDS_SECTIONS = [
  { value: 'operating', label: 'Операционная' },
  { value: 'investing', label: 'Инвестиционная' },
  { value: 'financing', label: 'Финансовая' },
  { value: 'transfer', label: 'Перемещение' },
];

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

export default function MappingClient({ articles }: { articles: Article[] }) {
  const router = useRouter();
  const [items, setItems] = useState(articles);
  const [filter, setFilter] = useState<'all' | 'unmapped' | 'mapped'>('unmapped');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'turnover'>('turnover');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [autoMapping, setAutoMapping] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let r = items.filter((a) => !a.isFolder);
    if (filter === 'unmapped') r = r.filter((a) => !a.opiuCategory);
    if (filter === 'mapped') r = r.filter((a) => a.opiuCategory);
    if (search) {
      const s = search.toLowerCase();
      r = r.filter((a) => a.name.toLowerCase().includes(s));
    }
    if (sortBy === 'turnover') r = [...r].sort((a, b) => b.turnover - a.turnover);
    else r = [...r].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return r;
  }, [items, filter, search, sortBy]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));
  const someSelected = selected.size > 0;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function toggleAll() {
    if (allSelected) {
      const next = new Set(selected);
      for (const a of filtered) next.delete(a.id);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const a of filtered) next.add(a.id);
      setSelected(next);
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function update(id: string, field: 'opiuCategory' | 'ddsSection', value: string) {
    setSavingId(id);
    try {
      const r = await fetch('/api/articles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value || null }),
      });
      if (r.ok) {
        setItems((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value || null } : a)));
      }
    } finally {
      setSavingId(null);
    }
  }

  async function bulkApply() {
    if (selected.size === 0 || !bulkCategory) return;
    const ids = Array.from(selected);
    const r = await fetch('/api/articles/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, opiuCategory: bulkCategory }),
    });
    const j = await r.json();
    if (r.ok) {
      setItems((prev) => prev.map((a) => ids.includes(a.id) ? { ...a, opiuCategory: bulkCategory } : a));
      setSelected(new Set());
      setBulkCategory('');
      showToast(`Назначено: ${j.updated} статей`);
    }
  }

  async function applyAutoMapping() {
    setAutoMapping(true);
    try {
      const r = await fetch('/api/articles/automap', { method: 'POST' });
      const j = await r.json();
      if (r.ok) {
        showToast(`Автомаппинг: размечено ${j.updated} из ${j.total} (${j.leftUnmapped} остались)`);
        router.refresh();
      }
    } finally {
      setAutoMapping(false);
    }
  }

  const unmappedCount = items.filter((a) => !a.isFolder && !a.opiuCategory).length;

  return (
    <div className="space-y-3">
      {/* Подсказка */}
      <div className="hint">
        <IconInfo className="hint-icon" />
        <div className="flex-1 text-sm">
          <b>Подсказка:</b> отсортируйте по обороту, чтобы сначала разметить самые крупные статьи —
          именно от них зависит точность ОПиУ. Выбирайте несколько строк галочками и применяйте
          одну категорию массово.
        </div>
      </div>

      {/* Тулбар */}
      <div className="panel p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="🔍 Поиск по названию"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[240px] max-w-md bg-white"
          />
          <div className="toggle-group">
            <button onClick={() => setFilter('all')} className={'toggle-btn ' + (filter === 'all' ? 'toggle-btn-active' : '')}>Все</button>
            <button onClick={() => setFilter('unmapped')} className={'toggle-btn ' + (filter === 'unmapped' ? 'toggle-btn-active' : '')}>
              Без категории {unmappedCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px]">{unmappedCount}</span>}
            </button>
            <button onClick={() => setFilter('mapped')} className={'toggle-btn ' + (filter === 'mapped' ? 'toggle-btn-active' : '')}>Размечены</button>
          </div>
          <div className="toggle-group ml-auto">
            <span className="px-2 py-1.5 text-xs text-gray-500 self-center">Сортировка:</span>
            <button onClick={() => setSortBy('turnover')} className={'toggle-btn ' + (sortBy === 'turnover' ? 'toggle-btn-active' : '')}>По обороту</button>
            <button onClick={() => setSortBy('name')} className={'toggle-btn ' + (sortBy === 'name' ? 'toggle-btn-active' : '')}>По имени</button>
          </div>
          <button
            onClick={applyAutoMapping}
            disabled={autoMapping}
            className="btn btn-secondary"
            title="Применить расширенный автомаппинг к статьям без категории"
          >
            <IconRefresh width={14} height={14} className={autoMapping ? 'animate-spin' : ''} />
            {autoMapping ? 'Применяю…' : 'Авто-маппинг'}
          </button>
        </div>

        {/* Bulk-bar */}
        {someSelected && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg text-sm">
            <span className="font-medium text-brand-900">Выбрано: {selected.size}</span>
            <select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
            >
              <option value="">Назначить категорию…</option>
              {OPIU_OPTIONS.filter((o) => o.value).map((o) => (
                <option key={o.value} value={o.value}>{o.group} → {o.label}</option>
              ))}
            </select>
            <button onClick={bulkApply} disabled={!bulkCategory} className="btn btn-primary disabled:opacity-50">
              Применить ко всем
            </button>
            <button onClick={() => setSelected(new Set())} className="btn btn-ghost">
              <IconX width={14} height={14} /> Снять выделение
            </button>
          </div>
        )}
      </div>

      {/* Таблица */}
      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>Статья ДДС</th>
              <th className="text-right w-32">Оборот</th>
              <th className="text-right w-20">Док-в</th>
              <th className="w-56">Категория ОПиУ</th>
              <th className="w-40">Раздел ДДС</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-500 py-8">Нет статей по фильтру</td></tr>
            )}
            {filtered.map((a) => (
              <tr key={a.id} className={!a.opiuCategory ? 'bg-amber-50/40' : ''}>
                <td><input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleOne(a.id)} /></td>
                <td>
                  <div className="flex items-center gap-2">
                    <span>{a.name}</span>
                    {!a.opiuCategory && a.turnover > 0 && (
                      <span className="pill pill-amber text-[10px]"><IconWarning width={10} height={10} /> важная</span>
                    )}
                    {savingId === a.id && <span className="text-xs text-gray-400">сохраняю…</span>}
                  </div>
                </td>
                <td className="num text-xs">{a.turnover > 0 ? fmt(a.turnover) + ' ₸' : '—'}</td>
                <td className="num text-xs text-gray-500">{a.docCount || '—'}</td>
                <td>
                  <select
                    value={a.opiuCategory || ''}
                    onChange={(e) => update(a.id, 'opiuCategory', e.target.value)}
                    className={
                      'border rounded-lg px-2 py-1 text-sm w-full bg-white ' +
                      (a.opiuCategory ? 'border-gray-300' : 'border-amber-300 bg-amber-50/60')
                    }
                  >
                    {OPIU_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value ? o.group + ' → ' + o.label : o.label}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    value={a.ddsSection || 'operating'}
                    onChange={(e) => update(a.id, 'ddsSection', e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-full bg-white"
                  >
                    {DDS_SECTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm z-50">
          <IconCheck width={16} height={16} /> {toast}
        </div>
      )}
    </div>
  );
}

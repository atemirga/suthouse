'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import {
  startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter,
  startOfYear, endOfYear,
  subMonths, format, parseISO, isSameDay,
} from 'date-fns';
import { IconFilter } from './Icons';

type Granularity = 'day' | 'week' | 'month';

interface Preset {
  key: string;
  label: string;
  range: () => { from: Date; to: Date };
  recommendedGran?: Granularity;
}

const presets: Preset[] = [
  { key: 'this_month', label: 'Тек. месяц', range: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }), recommendedGran: 'month' },
  { key: 'last_month', label: 'Прошл. месяц', range: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }), recommendedGran: 'month' },
  { key: 'last_3', label: '3 месяца', range: () => ({ from: startOfMonth(subMonths(new Date(), 2)), to: endOfMonth(new Date()) }), recommendedGran: 'month' },
  { key: 'last_6', label: '6 месяцев', range: () => ({ from: startOfMonth(subMonths(new Date(), 5)), to: endOfMonth(new Date()) }), recommendedGran: 'month' },
  { key: 'ytd', label: 'С начала года', range: () => ({ from: startOfYear(new Date()), to: endOfMonth(new Date()) }), recommendedGran: 'month' },
  { key: 'quarter', label: 'Квартал', range: () => ({ from: startOfQuarter(new Date()), to: endOfQuarter(new Date()) }), recommendedGran: 'month' },
  { key: 'year', label: 'Год', range: () => ({ from: startOfYear(new Date()), to: endOfYear(new Date()) }), recommendedGran: 'month' },
  { key: 'last_12', label: '12 месяцев', range: () => ({ from: startOfMonth(subMonths(new Date(), 11)), to: endOfMonth(new Date()) }), recommendedGran: 'month' },
];

function fmt(d: Date) { return format(d, 'yyyy-MM-dd'); }

export default function PeriodPicker({ showGranularity = true }: { showGranularity?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const initialFrom = sp.get('from') || fmt(startOfMonth(new Date()));
  const initialTo = sp.get('to') || fmt(endOfMonth(new Date()));
  const initialGran = (sp.get('granularity') as Granularity) || 'month';

  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [granularity, setGranularity] = useState<Granularity>(initialGran);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setFrom(sp.get('from') || fmt(startOfMonth(new Date())));
    setTo(sp.get('to') || fmt(endOfMonth(new Date())));
    setGranularity((sp.get('granularity') as Granularity) || 'month');
  }, [sp]);

  const activePreset = useMemo(() => {
    const fromD = parseISO(from);
    const toD = parseISO(to);
    return presets.find((p) => {
      const r = p.range();
      return isSameDay(r.from, fromD) && isSameDay(r.to, toD);
    });
  }, [from, to]);

  function apply(nextFrom: string, nextTo: string, nextGran?: Granularity) {
    const params = new URLSearchParams(sp.toString());
    params.set('from', nextFrom);
    params.set('to', nextTo);
    if (nextGran) params.set('granularity', nextGran);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function applyPreset(p: Preset) {
    const r = p.range();
    const f = fmt(r.from);
    const t = fmt(r.to);
    setFrom(f); setTo(t);
    if (p.recommendedGran) setGranularity(p.recommendedGran);
    apply(f, t, p.recommendedGran || granularity);
  }

  return (
    <div className="panel">
      <div className="px-4 py-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium uppercase tracking-wider mr-1">
          <IconFilter width={14} height={14} /> Период
        </div>

        {/* Пресеты */}
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              className={
                'px-2.5 py-1 text-xs rounded-md transition-colors ' +
                (activePreset?.key === p.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
              }
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setOpen((v) => !v)}
            className={
              'px-2.5 py-1 text-xs rounded-md transition-colors ' +
              (!activePreset ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
            }
          >
            {!activePreset ? `${from} … ${to}` : 'Произвольный…'}
          </button>
        </div>

        {showGranularity && (
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-gray-500 uppercase tracking-wider">Шаг:</span>
            <div className="toggle-group">
              {(['day', 'week', 'month'] as Granularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => apply(from, to, g)}
                  className={'toggle-btn ' + (granularity === g ? 'toggle-btn-active' : '')}
                >
                  {g === 'day' ? 'День' : g === 'week' ? 'Нед' : 'Мес'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {open && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">С</label>
            <input
              type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">По</label>
            <input
              type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            />
          </div>
          <button onClick={() => apply(from, to, granularity)} className="btn btn-primary">
            Применить
          </button>
        </div>
      )}
    </div>
  );
}

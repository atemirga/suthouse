'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SyncClient() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [days, setDays] = useState('60');
  const [skipCatalogs, setSkipCatalogs] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function run(fullReload = false) {
    if (running) return;
    setRunning(true);
    setLastResult(null);
    try {
      const params = new URLSearchParams();
      params.set('days', fullReload ? '3650' : days);
      if (skipCatalogs && !fullReload) params.set('skipCatalogs', '1');
      const r = await fetch('/api/sync?' + params.toString(), { method: 'POST' });
      const data = await r.json();
      setLastResult(`${data.ok ? '✓ OK' : '✗ FAIL'} (${data.durationMs}ms): ${JSON.stringify(data.details).slice(0, 400)}`);
      router.refresh();
    } catch (e: any) {
      setLastResult('Ошибка: ' + e.message);
    } finally {
      setRunning(false);
    }
  }

  async function recomputeFifo() {
    if (running) return;
    setRunning(true);
    setLastResult(null);
    try {
      const r = await fetch('/api/sync/fifo', { method: 'POST' });
      const data = await r.json();
      setLastResult(
        data.ok
          ? `✓ FIFO пересчитан (${data.durationMs}ms): items=${data.itemsProcessed}, реализаций=${data.realizationsTouched}, fallback (нехватка партий)=${data.shortageHits}, без закупок=${data.noPurchaseEver}`
          : `✗ FAIL: ${data.error}`,
      );
      router.refresh();
    } catch (e: any) {
      setLastResult('Ошибка: ' + e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-0.5">Дней назад</label>
          <input type="number" value={days} onChange={(e) => setDays(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm w-24" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={skipCatalogs} onChange={(e) => setSkipCatalogs(e.target.checked)} />
          Пропустить справочники
        </label>
        <button onClick={() => run(false)} disabled={running} className="px-3 py-1.5 bg-brand-600 text-white text-sm rounded hover:bg-brand-700 disabled:opacity-50">
          {running ? 'Синхронизация…' : 'Синхронизировать'}
        </button>
        <button onClick={() => { if (confirm('Полная перезагрузка может занять долго. Продолжить?')) run(true); }} disabled={running} className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50">
          Полная перезагрузка
        </button>
        <button onClick={recomputeFifo} disabled={running} className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 disabled:opacity-50" title="Пересчитать себестоимость по FIFO без обращения к 1С">
          Пересчитать FIFO
        </button>
      </div>
      {lastResult && (
        <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap">{lastResult}</pre>
      )}
    </div>
  );
}

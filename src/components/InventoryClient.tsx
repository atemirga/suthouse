'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { IconRefresh } from './Icons';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(n);

export default function InventoryClient({ initial, warehouses }: { initial: any; warehouses: { id: string; name: string }[] }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch('/api/inventory/balances?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setWarehouse(id: string) {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set('warehouseId', id); else p.delete('warehouseId');
    router.push(`${pathname}?${p.toString()}`);
  }

  async function resync() {
    setResyncing(true);
    try {
      const r = await fetch('/api/inventory/balances', { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        // Перезагрузим отчёт
        const r2 = await fetch('/api/inventory/balances?' + sp.toString());
        const d = await r2.json();
        if (!d.error) setData(d);
      }
    } finally { setResyncing(false); }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r: any) => r.nomenclatureName.toLowerCase().includes(q));
  }, [data, search]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;

  const t = data.totals;

  return (
    <div className="space-y-5">
      {(loading || resyncing) && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <IconRefresh className="animate-spin" width={12} height={12} />
          {resyncing ? 'Пересинхронизация остатков из 1С…' : 'Обновляю данные…'}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Складов" value={String(t.warehouses)} />
        <Kpi label="Позиций" value={String(t.positions)} />
        <Kpi label="Кол-во всего" value={fmt(t.quantity)} />
        <div className="kpi-card flex flex-col justify-between">
          <div className="kpi-label">Действия</div>
          <button onClick={resync} disabled={resyncing}
                  className="btn btn-secondary text-xs justify-center mt-1">
            <IconRefresh width={12} height={12} /> Обновить из 1С
          </button>
        </div>
      </div>

      {data.byWarehouse.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {data.byWarehouse.map((w: any) => (
            <div key={w.name} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider">Склад</div>
              <div className="text-base font-semibold mt-1">{w.name}</div>
              <div className="text-2xl font-bold tabular-nums mt-2">{fmt(w.quantity)}</div>
              <div className="text-xs text-gray-500">{w.positions} позиций</div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="px-4 py-3 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Склад</div>
            <select value={sp.get('warehouseId') || ''} onChange={(e) => setWarehouse(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[200px]">
              <option value="">— все —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[240px]">
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Поиск</div>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Поиск по позиции…"
                   className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" />
          </div>
          <div className="text-xs text-gray-500">Показано {rows.length}</div>
        </div>
      </div>

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th>Склад</th>
              <th>Позиция</th>
              <th className="text-right">Количество</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-500 py-8">Нет остатков</td></tr>
            )}
            {rows.slice(0, 1000).map((r: any, i: number) => (
              <tr key={i}>
                <td className="text-gray-400 text-xs">{i + 1}</td>
                <td className="text-xs">{r.warehouseName}</td>
                <td className="text-sm">{r.nomenclatureName}</td>
                <td className="num">{fmt(r.quantity)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="total">
                <td colSpan={3}>Итого</td>
                <td className="num">{fmt(rows.reduce((s: number, r: any) => s + r.quantity, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { IconRefresh } from './Icons';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtKg = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
};
const fmtDays = (n: number) => (!isFinite(n) ? '∞' : n.toFixed(0));

type SortKey =
  | 'warehouseName' | 'nomenclatureName'
  | 'quantity' | 'costPrice' | 'costAmount'
  | 'sold30' | 'sold90' | 'velocity30' | 'daysCover'
  | 'reorderQty' | 'reorderAmount';

export default function InventoryClient({ initial, warehouses }: { initial: any; warehouses: { id: string; name: string }[] }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('costAmount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [onlyReorder, setOnlyReorder] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/api/inventory/balances?' + sp.toString())
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  }, [sp]);

  function setQp(key: string, value: string) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  }

  async function resync() {
    setResyncing(true);
    try {
      const r = await fetch('/api/inventory/balances', { method: 'POST' });
      const j = await r.json();
      if (j.ok) {
        const r2 = await fetch('/api/inventory/balances?' + sp.toString());
        const d = await r2.json();
        if (!d.error) setData(d);
      }
    } finally { setResyncing(false); }
  }

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'warehouseName' || k === 'nomenclatureName' ? 'asc' : 'desc'); }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    let arr = data.rows.filter((r: any) => {
      if (q && !r.nomenclatureName.toLowerCase().includes(q)) return false;
      if (onlyReorder && r.reorderQty <= 0) return false;
      return true;
    });
    arr = [...arr].sort((a: any, b: any) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb, 'ru') : vb.localeCompare(va, 'ru');
      const av = !isFinite(va as number) ? Number.MAX_VALUE : (va as number);
      const bv = !isFinite(vb as number) ? Number.MAX_VALUE : (vb as number);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [data, search, sortKey, sortDir, onlyReorder]);

  if (!data) return <div className="text-center text-gray-500 py-12">Загрузка...</div>;
  const t = data.totals;
  const coverDays = data.coverDays || 30;

  const SortHeader = ({ label, k, align = 'right', hint }: { label: string; k: SortKey; align?: 'left' | 'right'; hint?: string }) => {
    const active = k === sortKey;
    const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return (
      <th
        title={hint}
        className={`cursor-pointer select-none hover:bg-gray-100 ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => setSort(k)}
      >
        <span className={active ? 'text-brand-700 font-semibold' : ''}>{label}{arrow}</span>
      </th>
    );
  };

  return (
    <div className="space-y-5">
      {(loading || resyncing) && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <IconRefresh className="animate-spin" width={12} height={12} />
          {resyncing ? 'Пересинхронизация остатков из 1С…' : 'Обновляю данные…'}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Позиций" value={t.positions.toLocaleString('ru-RU')} sub={`${t.warehouses.toLocaleString('ru-RU')} складов`} />
        <Kpi label="Кол-во всего" value={fmtCompact(t.quantity)} suffix="кг" />
        <Kpi label="Себестоимость остатка" value={fmtCompact(t.costAmount)} suffix="₸" color="amber" />
        <Kpi
          label={`Продажи за 30 / 90 д.`}
          value={fmtCompact(t.sold30)}
          suffix="кг"
          sub={`90 дн: ${fmtCompact(t.sold90)} кг`}
        />
        <div className="kpi-card flex flex-col justify-between">
          <div>
            <div className="kpi-label">К закупке на {coverDays} дн.</div>
            <div className="kpi-value text-rose-700">{fmtCompact(t.reorderQty)} <span className="text-base text-gray-500">кг</span></div>
            <div className="text-xs text-gray-500">{fmtCompact(t.reorderAmount)} ₸</div>
          </div>
          <button onClick={resync} disabled={resyncing}
                  className="btn btn-secondary text-xs justify-center mt-2">
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
              <div className="flex items-baseline gap-3 mt-2">
                <div>
                  <div className="text-2xl font-bold tabular-nums">{fmtCompact(w.quantity)} <span className="text-sm text-gray-500">кг</span></div>
                  <div className="text-xs text-gray-500">{w.positions} позиций</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-base font-semibold tabular-nums text-amber-700">{fmtCompact(w.costAmount)} ₸</div>
                  <div className="text-[10px] text-gray-500">себестоимость</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="px-4 py-3 flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Склад</div>
            <select value={sp.get('warehouseId') || ''} onChange={(e) => setQp('warehouseId', e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white min-w-[200px]">
              <option value="">— все —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Покрытие, дн.</div>
            <select value={sp.get('coverDays') || '30'} onChange={(e) => setQp('coverDays', e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
              <option value="14">14</option>
              <option value="30">30</option>
              <option value="45">45</option>
              <option value="60">60</option>
              <option value="90">90</option>
            </select>
          </div>
          <div className="flex-1 min-w-[240px]">
            <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Поиск</div>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Поиск по позиции…"
                   className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer pb-1.5">
            <input type="checkbox" checked={onlyReorder} onChange={(e) => setOnlyReorder(e.target.checked)} />
            Только к закупке
          </label>
          <div className="text-xs text-gray-500 pb-1.5">Показано {rows.length}</div>
        </div>
      </div>

      <div className="panel">
        <div className="overflow-auto max-h-[75vh]">
          <table className="report w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
              <tr>
                <th className="w-8 text-gray-400">#</th>
                <SortHeader label="Склад" k="warehouseName" align="left" />
                <SortHeader label="Позиция" k="nomenclatureName" align="left" />
                <SortHeader label="Остаток, кг" k="quantity" hint="Снимок из 1С" />
                <SortHeader label="Цена закупки" k="costPrice" hint="Последняя цена закупки" />
                <SortHeader label="Себес остатка" k="costAmount" hint="Остаток × цена закупки" />
                <SortHeader label="Прод. 30д" k="sold30" hint="Отгружено кг за последние 30 дней" />
                <SortHeader label="Прод. 90д" k="sold90" hint="Отгружено кг за последние 90 дней" />
                <SortHeader label="кг/день" k="velocity30" hint="Скорость продаж = прод.30д / 30" />
                <SortHeader label="Дни покрытия" k="daysCover" hint="Остаток / скорость продаж. ∞ — продаж не было" />
                <SortHeader label={`К закупке (${coverDays}д)`} k="reorderQty" hint={`max(0, ${coverDays} × скорость − остаток)`} />
                <SortHeader label="Сумма закупки" k="reorderAmount" hint="К закупке × цена закупки" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={12} className="text-center text-gray-500 py-8">Нет остатков</td></tr>
              )}
              {rows.slice(0, 2000).map((r: any, i: number) => {
                const coverCls =
                  !isFinite(r.daysCover) ? 'text-gray-300' :
                  r.daysCover < 7 ? 'text-rose-700 font-semibold' :
                  r.daysCover < 14 ? 'text-amber-700' :
                  r.daysCover > 180 ? 'text-purple-600' :
                  'text-gray-700';
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="text-gray-400 text-xs">{i + 1}</td>
                    <td className="text-xs">{r.warehouseName}</td>
                    <td className="text-sm">{r.nomenclatureName}</td>
                    <td className="num">{fmtKg(r.quantity)}</td>
                    <td className="num text-xs">{r.costPrice > 0 ? fmt(r.costPrice) : <span className="text-gray-300">—</span>}</td>
                    <td className="num font-semibold text-amber-800">{r.costAmount > 0 ? fmt(r.costAmount) : <span className="text-gray-300">—</span>}</td>
                    <td className="num text-xs">{r.sold30 > 0 ? fmtKg(r.sold30) : <span className="text-gray-300">—</span>}</td>
                    <td className="num text-xs">{r.sold90 > 0 ? fmtKg(r.sold90) : <span className="text-gray-300">—</span>}</td>
                    <td className="num text-xs">{r.velocity30 > 0 ? fmtKg(r.velocity30) : <span className="text-gray-300">—</span>}</td>
                    <td className={'num text-xs ' + coverCls}>{r.velocity30 > 0 ? fmtDays(r.daysCover) : <span className="text-gray-300">—</span>}</td>
                    <td className="num text-rose-700 font-semibold">{r.reorderQty > 0 ? fmtKg(r.reorderQty) : <span className="text-gray-300">—</span>}</td>
                    <td className="num text-xs text-rose-700">{r.reorderAmount > 0 ? fmt(r.reorderAmount) : <span className="text-gray-300">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-brand-50 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
              <tr className="total border-t-2 border-brand-200">
                <td colSpan={3} className="font-semibold text-brand-700 uppercase text-xs tracking-wider">Итого</td>
                <td className="num">{fmtKg(rows.reduce((s: number, r: any) => s + r.quantity, 0))}</td>
                <td></td>
                <td className="num text-amber-800">{fmt(rows.reduce((s: number, r: any) => s + r.costAmount, 0))}</td>
                <td className="num">{fmtKg(rows.reduce((s: number, r: any) => s + r.sold30, 0))}</td>
                <td className="num">{fmtKg(rows.reduce((s: number, r: any) => s + r.sold90, 0))}</td>
                <td></td>
                <td></td>
                <td className="num text-rose-700">{fmtKg(rows.reduce((s: number, r: any) => s + r.reorderQty, 0))}</td>
                <td className="num text-rose-700">{fmt(rows.reduce((s: number, r: any) => s + r.reorderAmount, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="panel p-4 text-xs text-gray-600 leading-relaxed">
        <div className="font-semibold text-gray-800 mb-1">📋 Методика</div>
        <div className="space-y-1">
          <div><b>Остаток</b>: снимок из <code>AccumulationRegister_ЗапасыНаСкладах</code> (нажмите «Обновить из 1С» для свежих данных).</div>
          <div><b>Цена закупки</b>: последняя цена закупки этой номенклатуры (<code>ZakupkaItem.price</code>, возвраты исключены).</div>
          <div><b>Себес остатка</b>: остаток × цена закупки. Приближение — не учитывает партии FIFO.</div>
          <div><b>Продажи 30/90 д.</b>: <code>RealizaciaItem.quantity</code> за последние 30/90 дней (от сегодня).</div>
          <div><b>Скорость</b>: продажи 30 д ÷ 30 — средняя дневная отгрузка в кг.</div>
          <div><b>Дни покрытия</b>: остаток ÷ скорость. <span className="text-rose-700 font-semibold">&lt;7</span> — критично, <span className="text-amber-700">&lt;14</span> — скоро закончится, <span className="text-purple-600">&gt;180</span> — залёжка.</div>
          <div><b>К закупке</b>: <code>max(0, дни × скорость − остаток)</code>. Цель — покрыть выбранное число дней.</div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, suffix, sub, color }: any) {
  const cls =
    color === 'green' ? 'text-emerald-700' :
    color === 'amber' ? 'text-amber-700' :
    color === 'red' ? 'text-rose-700' :
    color === 'blue' ? 'text-blue-700' :
    'text-gray-900';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={'kpi-value ' + cls}>
        {value}{suffix && <span className="text-base font-semibold text-gray-500 ml-0.5">{suffix}</span>}
      </div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

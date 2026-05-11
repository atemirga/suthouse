'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useState } from 'react';

export default function RnpFiltersBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [status, setStatus] = useState(sp.get('status') || '');
  const [responsible, setResponsible] = useState(sp.get('responsible') || '');

  function apply() {
    const params = new URLSearchParams(sp.toString());
    if (status) params.set('status', status); else params.delete('status');
    if (responsible) params.set('responsible', responsible); else params.delete('responsible');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="panel p-3 flex flex-wrap items-end gap-3">
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-medium">Статус</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">С остатком (по умолчанию)</option>
          <option value="Открыт">Открыт</option>
          <option value="ВРаботе">В работе</option>
          <option value="Выполнен">Выполнен</option>
          <option value="Закрыт">Закрыт</option>
          <option value="ЗаказНаПродажу">Заказ на продажу (УНФ KZ)</option>
          <option value="all">Все</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5 font-medium">Менеджер</label>
        <input value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="ФИО точно" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" />
      </div>
      <button onClick={apply} className="btn btn-primary">Применить</button>
    </div>
  );
}

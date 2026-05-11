'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);

const SCOPE_LABELS: Record<string, string> = {
  total: 'Всего',
  category: 'По категории',
  sku: 'По позиции',
  manager: 'По менеджеру',
};

interface Ref { id: string; name: string }

export default function PlansClient({
  initial, employees, categories,
}: {
  initial: any[];
  employees: Ref[];
  categories: Ref[];
}) {
  const router = useRouter();
  const [plans, setPlans] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    scenarioName: 'Основной',
    startDate: today,
    endDate: today,
    scope: 'total',
    scopeId: '',
    scopeName: '',
    amountPlan: '',
    quantityPlan: '',
    responsible: '',
    comment: '',
  });

  async function submit() {
    setSubmitting(true);
    try {
      const refs = form.scope === 'category' ? categories : form.scope === 'manager' ? employees : [];
      const scopeName = form.scopeId ? refs.find((r) => r.id === form.scopeId)?.name || null : null;
      const r = await fetch('/api/sales/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          scopeId: form.scopeId || null,
          scopeName,
          amountPlan: Number(form.amountPlan || 0),
          quantityPlan: Number(form.quantityPlan || 0),
        }),
      });
      const j = await r.json();
      if (j.error) { alert('Ошибка: ' + j.error); return; }
      setPlans([j, ...plans]);
      setShowForm(false);
      router.refresh();
    } finally { setSubmitting(false); }
  }

  async function remove(id: string) {
    if (!confirm('Удалить план?')) return;
    const r = await fetch('/api/sales/plans?id=' + id, { method: 'DELETE' });
    if (r.ok) {
      setPlans(plans.filter((p) => p.id !== id));
      router.refresh();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {plans.length === 0 ? 'Планов пока нет — добавьте первый' : `${plans.length} планов`}
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary">
          {showForm ? 'Отмена' : '+ Новый план'}
        </button>
      </div>

      {showForm && (
        <div className="panel">
          <div className="panel-header"><div className="panel-title">Новый план продаж</div></div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Сценарий">
              <input value={form.scenarioName} onChange={(e) => setForm({ ...form, scenarioName: e.target.value })}
                     className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" />
            </Field>
            <Field label="Начало">
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                     className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" />
            </Field>
            <Field label="Окончание">
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                     className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" />
            </Field>
            <Field label="Тип плана">
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, scopeId: '' })}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full">
                <option value="total">Всего по компании</option>
                <option value="category">По категории номенклатуры</option>
                <option value="manager">По менеджеру</option>
              </select>
            </Field>
            {form.scope !== 'total' && (
              <Field label={form.scope === 'category' ? 'Категория' : 'Менеджер'}>
                <select value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full">
                  <option value="">— выбрать —</option>
                  {(form.scope === 'category' ? categories : employees).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Сумма плана (₸)">
              <input type="number" value={form.amountPlan} onChange={(e) => setForm({ ...form, amountPlan: e.target.value })}
                     className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" placeholder="0" />
            </Field>
            <Field label="Кол-во плана">
              <input type="number" value={form.quantityPlan} onChange={(e) => setForm({ ...form, quantityPlan: e.target.value })}
                     className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" placeholder="0" />
            </Field>
            <Field label="Ответственный">
              <input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })}
                     className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-full" placeholder="Имя ответственного" />
            </Field>
            <div className="md:col-span-3">
              <Field label="Комментарий">
                <input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })}
                       className="input w-full" />
              </Field>
            </div>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="btn btn-secondary">Отмена</button>
              <button onClick={submit} disabled={submitting || !form.startDate || !form.endDate || !form.amountPlan} className="btn btn-primary">
                {submitting ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="panel overflow-auto">
        <table className="report">
          <thead>
            <tr>
              <th>Сценарий</th>
              <th>Период</th>
              <th>Тип</th>
              <th>Объект</th>
              <th>Ответственный</th>
              <th className="text-right">Сумма плана</th>
              <th className="text-right">Кол-во плана</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && (
              <tr><td colSpan={8} className="text-center text-gray-500 py-8">Планов пока нет</td></tr>
            )}
            {plans.map((p) => (
              <tr key={p.id}>
                <td>{p.scenarioName}</td>
                <td className="text-xs">
                  {format(new Date(p.startDate), 'dd.MM.yyyy')} — {format(new Date(p.endDate), 'dd.MM.yyyy')}
                </td>
                <td className="text-xs">{SCOPE_LABELS[p.scope] || p.scope}</td>
                <td className="text-xs">{p.scopeName || '—'}</td>
                <td className="text-xs">{p.responsible || '—'}</td>
                <td className="num">{fmt(p.amountPlan)}</td>
                <td className="num text-xs">{p.quantityPlan ? fmt(p.quantityPlan) : '—'}</td>
                <td><button onClick={() => remove(p.id)} className="text-xs text-rose-700 hover:underline">Удалить</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1 uppercase tracking-wider">{label}</div>
      {children}
    </div>
  );
}

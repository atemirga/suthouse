'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const fmt = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + ' млрд';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + ' млн';
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + ' тыс';
  return String(Math.round(n));
};

interface SeriesPoint {
  period: string;
  [key: string]: string | number;
}

interface SeriesDef {
  key: string;
  label: string;
  color?: string;
}

export function MultiSeriesChart({
  data,
  series,
  type,
  height = 280,
  yFormat = fmtCompact,
}: {
  data: SeriesPoint[];
  series: SeriesDef[];
  type: 'line' | 'bar' | 'area';
  height?: number;
  yFormat?: (n: number) => string;
}) {
  const ChartComp = type === 'line' ? LineChart : type === 'area' ? AreaChart : BarChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ChartComp data={data} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="period" tick={{ fill: '#64748b', fontSize: 11 }} />
        <YAxis tickFormatter={yFormat} tick={{ fill: '#64748b', fontSize: 11 }} width={70} />
        <Tooltip
          formatter={(value: any) => fmt(Number(value)) + ' ₸'}
          contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => {
          const color = s.color || COLORS[i % COLORS.length];
          if (type === 'line') {
            return <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color} strokeWidth={2} dot={{ r: 3 }} />;
          }
          if (type === 'area') {
            return <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} />;
          }
          return <Bar key={s.key} dataKey={s.key} name={s.label} fill={color} radius={[3, 3, 0, 0]} />;
        })}
      </ChartComp>
    </ResponsiveContainer>
  );
}

export function PieBreakdown({
  data,
  height = 260,
}: {
  data: { name: string; value: number }[];
  height?: number;
}) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={90}
          innerRadius={50}
          paddingAngle={2}
        >
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip
          formatter={(value: any, name: any) => [
            fmt(Number(value)) + ' ₸ (' + ((Number(value) / total) * 100).toFixed(1) + '%)',
            name,
          ]}
          contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBar({
  data,
  height = 320,
}: {
  data: { name: string; value: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis type="number" tickFormatter={fmtCompact} tick={{ fill: '#64748b', fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fill: '#374151', fontSize: 11 }} width={140} />
        <Tooltip
          formatter={(value: any) => fmt(Number(value)) + ' ₸'}
          contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
        />
        <Bar dataKey="value" fill="#3b82f6" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ViewSwitcher({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="toggle-group">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={'toggle-btn flex items-center gap-1 ' + (value === o.key ? 'toggle-btn-active' : '')}
          title={o.label}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

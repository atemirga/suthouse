'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, RadialBarChart, RadialBar, PolarAngleAxis,
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
  return Math.round(n).toLocaleString('ru-RU');
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
        <defs>
          {series.map((s, i) => {
            const color = s.color || COLORS[i % COLORS.length];
            return (
              <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.38} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="period" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yFormat} tick={{ fill: '#64748b', fontSize: 11 }} width={70} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value: any) => fmt(Number(value)) + ' ₸'}
          contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
          cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => {
          const color = s.color || COLORS[i % COLORS.length];
          const anim = { isAnimationActive: true, animationDuration: 900, animationBegin: i * 130 };
          if (type === 'line') {
            return <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} {...anim} />;
          }
          if (type === 'area') {
            return <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color} strokeWidth={2.5} fill={`url(#area-${s.key})`} {...anim} />;
          }
          return <Bar key={s.key} dataKey={s.key} name={s.label} fill={color} radius={[4, 4, 0, 0]} {...anim} />;
        })}
      </ChartComp>
    </ResponsiveContainer>
  );
}

export function PieBreakdown({
  data,
  height = 260,
  centerLabel,
}: {
  data: { name: string; value: number }[];
  height?: number;
  centerLabel?: string;
}) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={92}
            innerRadius={60}
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
            animationDuration={900}
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
      {/* Центральная цифра внутри donut (по верхней части, где кольцо) */}
      <div
        className="absolute inset-x-0 flex flex-col items-center justify-center pointer-events-none"
        style={{ top: 0, height: height - 40 }}
      >
        <div className="text-[10px] uppercase tracking-wider text-gray-400">{centerLabel || 'Всего'}</div>
        <div className="text-lg font-bold tabular-nums text-gray-900">{fmtCompact(total)}</div>
        <div className="text-[10px] text-gray-400">₸</div>
      </div>
    </div>
  );
}

// Радиальный gauge (полукруг-«спидометр») для маржи/выполнения
export function RadialGauge({
  pct,
  label,
  sub,
  color = '#10b981',
  height = 150,
}: {
  pct: number;
  label: string;
  sub?: string;
  color?: string;
  height?: number;
}) {
  const v = Math.max(0, Math.min(100, pct));
  const data = [{ name: label, value: v, fill: color }];
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <RadialBarChart
          innerRadius="68%"
          outerRadius="100%"
          data={data}
          startAngle={220}
          endAngle={-40}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: '#f1f5f9' }}
            dataKey="value"
            cornerRadius={12}
            angleAxisId={0}
            animationDuration={1000}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-2xl font-bold tabular-nums" style={{ color }}>{v.toFixed(1)}%</div>
        <div className="text-[11px] font-medium text-gray-600">{label}</div>
        {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </div>
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

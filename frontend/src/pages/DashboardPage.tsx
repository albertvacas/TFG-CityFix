import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { getDashboardData } from '../api/analytics';
import type { DashboardData } from '../api/analytics';
import type { State, Category } from '../types';
import { CATEGORY_LABELS } from '../types';

/* ── Color maps ── */

const STATE_COLORS: Record<State, string> = {
  OPEN: '#3b82f6',
  ASSIGNED: '#0e2f61',
  IN_PROGRESS: '#db7a20',
  VALIDATED: '#389625',
  CLOSED: '#c03939',
};

const STATE_LABELS: Record<State, string> = {
  OPEN: 'Obertes',
  ASSIGNED: 'Assignades',
  IN_PROGRESS: 'En procés',
  VALIDATED: 'Validades',
  CLOSED: 'Tancades',
};

const CATEGORY_COLORS: Record<Category, string> = {
  LIGHTING: '#a39b2b',
  URBAN_FURNITURE: '#7c3aed',
  PAVEMENT: '#475569',
  CLEANING: '#0a4e61',
  GREEN_AREAS: '#15803d',
  SIGNAGE: '#1e166b',
  ACCESSIBILITY: '#530d50',
  TECHNOLOGY: '#610d0d',
  OTHER: '#4e3218',
};

const PRIORITY_Y: Record<string, number> = {
  LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baixa', MEDIUM: 'Mitjana', HIGH: 'Alta', CRITICAL: 'Crítica',
};

/* ── Helpers ── */

const formatDate = (d: string) => {
  const date = new Date(d);
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
};

/** Pivota historyByCategory a files on cada columna és una categoria */
function pivotHistory(data: DashboardData['historyByCategory']) {
  const map = new Map<string, Record<string, number>>();
  for (const row of data) {
    if (!map.has(row.period)) map.set(row.period, {});
    map.get(row.period)![row.category] = row.count;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, cats]) => ({ period, ...cats }));
}

/* ── Component ── */

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week');
  const [days, setDays] = useState(90);

  useEffect(() => {
    setLoading(true);
    getDashboardData(granularity, days)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [granularity, days]);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const { stateCounts, criticalHigh, historyByCategory, createdVsResolved, technicianWorkload, resolutionTime, categoryDistribution, topReporters } = data;

  // Donut data
  const donutData = (Object.keys(STATE_COLORS) as State[]).map((state) => ({
    name: STATE_LABELS[state],
    value: stateCounts.counts[state] || 0,
    color: STATE_COLORS[state],
  }));

  // Pivoted area chart data
  const areaData = pivotHistory(historyByCategory);
  const allCategories = Array.from(new Set(historyByCategory.map((h) => h.category)));

  // Scatter data with numeric priority
  const scatterData = resolutionTime.map((r) => ({
    x: r.hoursToResolve,
    y: PRIORITY_Y[r.priority] || 0,
    priority: r.priority,
  }));

  // Sorted workload
  const sortedWorkload = [...technicianWorkload].sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex gap-2">
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="day">Diari</option>
            <option value="week">Setmanal</option>
            <option value="month">Mensual</option>
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value={30}>Últims 30 dies</option>
            <option value={90}>Últims 90 dies</option>
            <option value={180}>Últims 180 dies</option>
            <option value={365}>Últim any</option>
          </select>
        </div>
      </div>

      {/* ── Bloc 1: Estat en temps real ── */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 lg:col-span-1">
          {(Object.keys(STATE_COLORS) as State[]).map((state) => (
            <button
              key={state}
              onClick={() => navigate(`/reports?state=${state}`)}
              className="rounded-xl bg-white p-4 text-left ring-1 ring-gray-200 transition-shadow hover:shadow-md"
            >
              <p className="text-xs font-medium text-gray-500">{STATE_LABELS[state]}</p>
              <p className="mt-1 text-2xl font-bold" style={{ color: STATE_COLORS[state] }}>
                {stateCounts.counts[state] || 0}
              </p>
            </button>
          ))}
          {/* Critical/High percentage */}
          <div className="col-span-2 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
            <p className="text-xs font-medium text-red-600">Crítiques + Altes</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-red-700">{criticalHigh.percentage}%</span>
              <span className="text-sm text-red-500">({criticalHigh.criticalHigh} de {criticalHigh.total})</span>
            </div>
          </div>
        </div>

        {/* Donut chart */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Distribució per estat</h2>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
                dataKey="value"
                label={(props: any) => `${props.name} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
              >
                {donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Bloc 2: Anàlisi temporal ── */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Stacked bar chart by category */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Històric per categoria</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={areaData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip
                labelFormatter={(v) => formatDate(v as string)}
                formatter={((value: any, name: any) => [value, CATEGORY_LABELS[name as Category] || name]) as any}
              />
              {allCategories.map((cat, i) => (
                <Bar
                  key={cat}
                  dataKey={cat}
                  stackId="1"
                  fill={i % 2 === 0 ? '#1e3a5f' : '#2d5986'}
                  radius={i === allCategories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Created vs resolved */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Creades vs Tancades</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={createdVsResolved}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip labelFormatter={(v) => formatDate(v as string)} />
              <Legend />
              <Bar dataKey="created" name="Creades" fill="#3467b9" radius={[4, 4, 0, 0]} />
              <Bar dataKey="resolved" name="Tancades" fill="#25a153" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Bloc 3: Rendiment ── */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Technician workload */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Workload per tècnic</h2>
          {sortedWorkload.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Sense dades de tècnics</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, sortedWorkload.length * 50)}>
              <BarChart data={sortedWorkload} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                <Tooltip />
                <Legend />
                <Bar dataKey="ASSIGNED" name="Assignades" stackId="a" fill="#eab308" />
                <Bar dataKey="IN_PROGRESS" name="En procés" stackId="a" fill="#f97316" />
                <Bar dataKey="VALIDATED" name="Validades" stackId="a" fill="#22c55e" />
                <Bar dataKey="CLOSED" name="Tancades" stackId="a" fill="#6b7280" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Scatter: resolution time vs priority */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Temps de resolució vs Prioritat</h2>
          {scatterData.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Sense incidències tancades</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Hores"
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Hores', position: 'insideBottom', offset: -5, fontSize: 12 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Prioritat"
                  domain={[0.5, 4.5]}
                  ticks={[1, 2, 3, 4]}
                  tickFormatter={(v) => PRIORITY_LABELS[Object.keys(PRIORITY_Y).find((k) => PRIORITY_Y[k] === v) || ''] || ''}
                  tick={{ fontSize: 12 }}
                />
                <ZAxis range={[60, 60]} />
                <Tooltip
                  formatter={((value: any, name: any) => {
                    const v = Number(value);
                    if (name === 'Hores') return [`${v}h`, 'Temps'];
                    const label = PRIORITY_LABELS[Object.keys(PRIORITY_Y).find((k) => PRIORITY_Y[k] === v) || ''];
                    return [label, 'Prioritat'];
                  }) as any}
                />
                <Scatter data={scatterData} fill="#6366f1" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Category bar chart + Top reporters */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Category distribution */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Distribució per categoria</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={categoryDistribution.map((d) => ({
                name: CATEGORY_LABELS[d.category] || d.category,
                count: d.count,
                fill: CATEGORY_COLORS[d.category],
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" name="Incidències" radius={[4, 4, 0, 0]}>
                {categoryDistribution.map((_d, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? '#5081c0' : '#bdd1e9'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top reporters */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Top Reporters</h2>
          {topReporters.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Sense dades</p>
          ) : (
            <div className="overflow-hidden rounded-lg ring-1 ring-gray-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="px-3 py-2 font-medium text-gray-500">Usuari</th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-right">Reports</th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-right">Punts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topReporters.map((r, i) => (
                    <tr key={r.userId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-bold text-indigo-600">{i + 1}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-400">@{r.nickname}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-700">{r.reportCount}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

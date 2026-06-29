import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { getDashboardData, getCategoryCounts } from '../api/analytics';
import type { DashboardData, CategoryCount } from '../api/analytics';
import type { State } from '../types';
import { useLiveEvent } from '../hooks/liveEvents';
import { useTheme } from '../context/ThemeContext';

/* ── Color maps ── */

const STATE_COLORS: Record<State, string> = {
  OPEN: '#3b82f6',
  ASSIGNED: '#0e2f61',
  IN_PROGRESS: '#db7a20',
  VALIDATED: '#389625',
  CLOSED: '#c03939',
};

const PRIORITY_Y: Record<string, number> = {
  LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

/* ── Helpers ── */

const formatDate = (d: string) => {
  const date = new Date(d);
  return `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
};

/* ── Component ── */

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week');
  const [days, setDays] = useState(90);
  // Rang de dates (calendari) del gràfic "Incidències per categoria". Per
  // defecte, els últims 30 dies fins avui. Es pot triar un sol dia (from === to).
  const [catFrom, setCatFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [catTo, setCatTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [catData, setCatData] = useState<CategoryCount[]>([]);
  const { resolved } = useTheme();
  const { t } = useTranslation();
  const isDark = resolved === 'dark';
  const stateLabel = (s: State) => t(`states.${s}`);
  const priorityLabel = (p: string) => t(`priorities.${p}`);

  // En mode fosc els blaus marins (#0e2f61, #1e3a5f) gairebé no es veuen sobre
  // la targeta fosca; els substituïm per blaus clars.
  const stateColors: Record<State, string> = isDark
    ? { ...STATE_COLORS, OPEN: '#3b82f6', ASSIGNED: '#60a5fa' }
    : STATE_COLORS;

  const refetch = useCallback(() => {
    getDashboardData(granularity, days)
      .then(setData)
      .catch(() => {});
  }, [granularity, days]);

  useEffect(() => {
    setLoading(true);
    refetch();
    setLoading(false);
  }, [refetch]);

  // Refresc en temps real: les agregacions canvien quan es crea o
  // transiciona una incidència. Les altres mètriques (prioritat, comentaris)
  // no afecten el dashboard, així que no recarreguem en aquests casos.
  useLiveEvent('report.created', refetch);
  useLiveEvent('report.transitioned', refetch);

  // El gràfic per categoria té el seu propi rang de dates i endpoint dedicat.
  const refetchCategory = useCallback(() => {
    getCategoryCounts(catFrom, catTo)
      .then(setCatData)
      .catch(() => {});
  }, [catFrom, catTo]);
  useEffect(() => {
    refetchCategory();
  }, [refetchCategory]);
  useLiveEvent('report.created', refetchCategory);
  useLiveEvent('report.transitioned', refetchCategory);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const { stateCounts, criticalHigh, createdVsResolved, technicianWorkload, resolutionTime, categoryDistribution, topReporters } = data;

  // Donut data
  const donutData = (Object.keys(STATE_COLORS) as State[]).map((state) => ({
    name: stateLabel(state),
    value: stateCounts.counts[state] || 0,
    color: stateColors[state],
  }));

  // Dades del gràfic per categoria (X = categoria, Y = nombre), ja ordenades
  // pel backend. Dos blaus alternats: les categories ja es distingeixen pel nom.
  const categoryBarData = catData.map((d) => ({
    name: t(`categories.${d.category}`, { defaultValue: d.category }),
    count: d.count,
  }));
  const barBlues = isDark ? ['#3b82f6', '#93c5fd'] : ['#1e40af', '#60a5fa'];

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
        <h1 className="text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <div className="flex gap-2">
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="day">{t('dashboard.daily')}</option>
            <option value="week">{t('dashboard.weekly')}</option>
            <option value="month">{t('dashboard.monthly')}</option>
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value={30}>{t('dashboard.last30')}</option>
            <option value={90}>{t('dashboard.last90')}</option>
            <option value={180}>{t('dashboard.last180')}</option>
            <option value={365}>{t('dashboard.lastYear')}</option>
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
              <p className="text-xs font-medium text-gray-500">{stateLabel(state)}</p>
              <p className="mt-1 text-2xl font-bold" style={{ color: stateColors[state] }}>
                {stateCounts.counts[state] || 0}
              </p>
            </button>
          ))}
          {/* Critical/High percentage */}
          <div className="col-span-2 rounded-xl bg-red-50 p-4 ring-1 ring-red-200">
            <p className="text-xs font-medium text-red-600">{t('dashboard.criticalHigh')}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-red-700">{criticalHigh.percentage}%</span>
              <span className="text-sm text-red-500">{t('dashboard.ofTotal', { value: criticalHigh.criticalHigh, total: criticalHigh.total })}</span>
            </div>
          </div>
        </div>

        {/* Donut chart */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('dashboard.distributionByState')}</h2>
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
        {/* Incidències per categoria (X = categoria, Y = nombre) amb filtre de dates */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-700">{t('dashboard.incidentsByCategory')}</h2>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>{t('dashboard.from')}</span>
              <input
                type="date"
                value={catFrom}
                max={catTo}
                onChange={(e) => setCatFrom(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
              />
              <span>{t('dashboard.to')}</span>
              <input
                type="date"
                value={catTo}
                min={catFrom}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setCatTo(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
          {categoryBarData.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">
              {t('dashboard.noIncidentsPeriod')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryBarData} margin={{ bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                  interval={0}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip formatter={((value: any) => [value, t('dashboard.incidents')]) as any} />
                <Bar dataKey="count" name={t('dashboard.incidents')} radius={[4, 4, 0, 0]} maxBarSize={64}>
                  {categoryBarData.map((_d, i) => (
                    <Cell key={i} fill={barBlues[i % 2]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Created vs resolved */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('dashboard.createdVsClosed')}</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={createdVsResolved}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={formatDate} tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip labelFormatter={(v) => formatDate(v as string)} />
              <Legend />
              <Bar dataKey="created" name={t('dashboard.created')} fill="#3467b9" radius={[4, 4, 0, 0]} />
              <Bar dataKey="resolved" name={t('dashboard.closed')} fill="#25a153" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Bloc 3: Rendiment ── */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Technician workload */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('dashboard.workloadByTech')}</h2>
          {sortedWorkload.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">{t('dashboard.noTechData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, sortedWorkload.length * 50)}>
              <BarChart data={sortedWorkload} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                <Tooltip />
                <Legend />
                <Bar dataKey="ASSIGNED" name={t('states.ASSIGNED')} stackId="a" fill="#eab308" />
                <Bar dataKey="IN_PROGRESS" name={t('states.IN_PROGRESS')} stackId="a" fill="#f97316" />
                <Bar dataKey="VALIDATED" name={t('states.VALIDATED')} stackId="a" fill="#22c55e" />
                <Bar dataKey="CLOSED" name={t('states.CLOSED')} stackId="a" fill="#6b7280" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Scatter: resolution time vs priority */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('dashboard.resolutionVsPriority')}</h2>
          {scatterData.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">{t('dashboard.noClosedIncidents')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={t('dashboard.hours')}
                  tick={{ fontSize: 12 }}
                  label={{ value: t('dashboard.hours'), position: 'insideBottom', offset: -5, fontSize: 12 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={t('dashboard.priority')}
                  domain={[0.5, 4.5]}
                  ticks={[1, 2, 3, 4]}
                  tickFormatter={(v) => priorityLabel(Object.keys(PRIORITY_Y).find((k) => PRIORITY_Y[k] === v) || '')}
                  tick={{ fontSize: 12 }}
                />
                <ZAxis range={[60, 60]} />
                <Tooltip
                  formatter={((value: any, name: any) => {
                    const v = Number(value);
                    if (name === t('dashboard.hours')) return [`${v}h`, t('dashboard.time')];
                    const label = priorityLabel(Object.keys(PRIORITY_Y).find((k) => PRIORITY_Y[k] === v) || '');
                    return [label, t('dashboard.priority')];
                  }) as any}
                />
                <Scatter data={scatterData} fill="#15803d" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Category bar chart + Top reporters */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Category distribution */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('dashboard.distributionByCategory')}</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={categoryDistribution.map((d) => ({
                name: t(`categories.${d.category}`, { defaultValue: d.category }),
                count: d.count,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" name={t('dashboard.incidents')} radius={[4, 4, 0, 0]} maxBarSize={64}>
                {categoryDistribution.map((_d, i) => (
                  <Cell key={i} fill={barBlues[i % 2]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top reporters */}
        <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('dashboard.topReporters')}</h2>
          {topReporters.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">{t('dashboard.noData')}</p>
          ) : (
            <div className="overflow-hidden rounded-lg ring-1 ring-gray-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 font-medium text-gray-500">#</th>
                    <th className="px-3 py-2 font-medium text-gray-500">{t('dashboard.user')}</th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-right">{t('dashboard.reports')}</th>
                    <th className="px-3 py-2 font-medium text-gray-500 text-right">{t('dashboard.points')}</th>
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

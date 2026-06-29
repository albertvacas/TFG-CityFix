import { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import MarkerClusterGroup from '../components/map/MarkerClusterGroup';
import HeatmapLayer from '../components/map/HeatmapLayer';
import { getGeoJson, getHeatmapData } from '../api/geo';
import type { GeoJsonFeature, HeatmapPoint } from '../api/geo';
import type { State, Category } from '../types';
import { CATEGORY_LABELS } from '../types';
import { useLiveEvent } from '../hooks/liveEvents';

type ViewMode = 'markers' | 'heatmap';
type WeightBy = 'priority' | 'density' | 'age';

const stateOptions: { value: '' | State; labelKey: string }[] = [
  { value: '', labelKey: 'reports.allStates' },
  { value: 'OPEN', labelKey: 'states.OPEN' },
  { value: 'ASSIGNED', labelKey: 'states.ASSIGNED' },
  { value: 'IN_PROGRESS', labelKey: 'states.IN_PROGRESS' },
  { value: 'VALIDATED', labelKey: 'states.VALIDATED' },
  { value: 'CLOSED', labelKey: 'states.CLOSED' },
];

const categoryOptions: { value: '' | Category; labelKey: string }[] = [
  { value: '', labelKey: 'mapPage.allCategories' },
  ...(Object.keys(CATEGORY_LABELS) as Category[]).map((value) => ({
    value,
    labelKey: `categories.${value}`,
  })),
];

const daysOptions = [
  { value: 0, labelKey: 'mapPage.anyDate' },
  { value: 7, labelKey: 'mapPage.last7' },
  { value: 30, labelKey: 'mapPage.last30' },
  { value: 90, labelKey: 'mapPage.last90' },
];

const weightOptions: { value: WeightBy; labelKey: string }[] = [
  { value: 'priority', labelKey: 'mapPage.byPriority' },
  { value: 'density', labelKey: 'mapPage.byDensity' },
  { value: 'age', labelKey: 'mapPage.byAge' },
];

const legendItems: { color: string; key: State }[] = [
  { color: '#3b82f6', key: 'OPEN' },
  { color: '#eab308', key: 'ASSIGNED' },
  { color: '#f97316', key: 'IN_PROGRESS' },
  { color: '#22c55e', key: 'VALIDATED' },
  { color: '#6b7280', key: 'CLOSED' },
];

// Centre UAB campus
const UAB_CENTER: [number, number] = [41.5025, 2.1060];

export default function MapPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('markers');
  const [weightBy, setWeightBy] = useState<WeightBy>('priority');

  // Filters
  const [stateFilter, setStateFilter] = useState<State | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<Category | ''>('');
  const [daysFilter, setDaysFilter] = useState(0);

  // Data
  const [features, setFeatures] = useState<GeoJsonFeature[]>([]);
  const [heatPoints, setHeatPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const filters = {
    state: stateFilter || undefined,
    category: categoryFilter || undefined,
    days: daysFilter || undefined,
  };

  const refetch = useCallback(() => {
    if (viewMode === 'markers') {
      getGeoJson(filters)
        .then((data) => setFeatures(data.features))
        .catch(() => {});
    } else {
      getHeatmapData(weightBy, filters)
        .then(setHeatPoints)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, weightBy, stateFilter, categoryFilter, daysFilter]);

  useEffect(() => {
    setLoading(true);
    refetch();
    setLoading(false);
  }, [refetch]);

  // Refresc en temps real del mapa quan apareixen noves incidències o
  // canvien d'estat (afecta visibilitat segons filtre).
  useLiveEvent('report.created', refetch);
  useLiveEvent('report.transitioned', refetch);

  const handleFeatureClick = useCallback(
    (id: string) => navigate(`/reports/${id}`),
    [navigate],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('mapPage.title')}</h1>
        <span className="text-sm text-gray-500">
          {loading
            ? t('common.loading')
            : t('mapPage.points', { count: viewMode === 'markers' ? features.length : heatPoints.length })}
        </span>
      </div>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {/* View mode toggle */}
        <div className="flex rounded-lg ring-1 ring-gray-300">
          <button
            onClick={() => setViewMode('markers')}
            className={`rounded-l-lg px-3 py-2 text-sm font-medium transition-colors ${
              viewMode === 'markers'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t('mapPage.markers')}
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className={`rounded-r-lg px-3 py-2 text-sm font-medium transition-colors ${
              viewMode === 'heatmap'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t('mapPage.heatmap')}
          </button>
        </div>

        {/* Heatmap weight selector */}
        {viewMode === 'heatmap' && (
          <select
            value={weightBy}
            onChange={(e) => setWeightBy(e.target.value as WeightBy)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {weightOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
            ))}
          </select>
        )}

        {/* State filter */}
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as State | '')}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {stateOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
          ))}
        </select>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as Category | '')}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {categoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
          ))}
        </select>

        {/* Days filter */}
        <select
          value={daysFilter}
          onChange={(e) => setDaysFilter(Number(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {daysOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
          ))}
        </select>
      </div>

      {/* Map */}
      <div className="overflow-hidden rounded-xl ring-1 ring-gray-200" style={{ height: '600px' }}>
        <MapContainer
          center={UAB_CENTER}
          zoom={16}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {viewMode === 'markers' && (
            <MarkerClusterGroup features={features} onFeatureClick={handleFeatureClick} />
          )}

          {viewMode === 'heatmap' && (
            <HeatmapLayer points={heatPoints} />
          )}
        </MapContainer>
      </div>

      {/* Legend */}
      {viewMode === 'markers' && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          {legendItems.map((item) => (
            <div key={item.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-gray-600">{t(`stateBadge.${item.key}`)}</span>
            </div>
          ))}
        </div>
      )}

      {viewMode === 'heatmap' && (
        <div className="mt-4 text-sm text-gray-500">
          {weightBy === 'priority' && t('mapPage.heatPriority')}
          {weightBy === 'density' && t('mapPage.heatDensity')}
          {weightBy === 'age' && t('mapPage.heatAge')}
        </div>
      )}
    </div>
  );
}

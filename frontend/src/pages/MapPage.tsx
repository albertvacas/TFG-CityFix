import { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import MarkerClusterGroup from '../components/map/MarkerClusterGroup';
import HeatmapLayer from '../components/map/HeatmapLayer';
import { getGeoJson, getHeatmapData } from '../api/geo';
import type { GeoJsonFeature, HeatmapPoint } from '../api/geo';
import type { State, Category } from '../types';
import { CATEGORY_LABELS } from '../types';

type ViewMode = 'markers' | 'heatmap';
type WeightBy = 'priority' | 'density' | 'age';

const stateOptions: { value: '' | State; label: string }[] = [
  { value: '', label: 'Tots els estats' },
  { value: 'OPEN', label: 'Obertes' },
  { value: 'ASSIGNED', label: 'Assignades' },
  { value: 'IN_PROGRESS', label: 'En procés' },
  { value: 'VALIDATED', label: 'Validades' },
  { value: 'CLOSED', label: 'Tancades' },
];

const categoryOptions: { value: '' | Category; label: string }[] = [
  { value: '', label: 'Totes les categories' },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
    value: value as Category,
    label,
  })),
];

const daysOptions = [
  { value: 0, label: 'Qualsevol data' },
  { value: 7, label: 'Últims 7 dies' },
  { value: 30, label: 'Últims 30 dies' },
  { value: 90, label: 'Últims 90 dies' },
];

const weightOptions: { value: WeightBy; label: string }[] = [
  { value: 'priority', label: 'Per prioritat' },
  { value: 'density', label: 'Per densitat' },
  { value: 'age', label: 'Per antiguitat' },
];

// Centre UAB campus
const UAB_CENTER: [number, number] = [41.5025, 2.1060];

export default function MapPage() {
  const navigate = useNavigate();
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

  useEffect(() => {
    setLoading(true);
    if (viewMode === 'markers') {
      getGeoJson(filters)
        .then((data) => setFeatures(data.features))
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      getHeatmapData(weightBy, filters)
        .then(setHeatPoints)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [viewMode, weightBy, stateFilter, categoryFilter, daysFilter]);

  const handleFeatureClick = useCallback(
    (id: string) => navigate(`/reports/${id}`),
    [navigate],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Mapa d'Incidències</h1>
        <span className="text-sm text-gray-500">
          {loading ? 'Carregant...' : `${viewMode === 'markers' ? features.length : heatPoints.length} punts`}
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
            Markers
          </button>
          <button
            onClick={() => setViewMode('heatmap')}
            className={`rounded-r-lg px-3 py-2 text-sm font-medium transition-colors ${
              viewMode === 'heatmap'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Mapa de calor
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
              <option key={opt.value} value={opt.value}>{opt.label}</option>
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
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Category filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as Category | '')}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {categoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Days filter */}
        <select
          value={daysFilter}
          onChange={(e) => setDaysFilter(Number(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {daysOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
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
          {[
            { color: '#3b82f6', label: 'Oberta' },
            { color: '#eab308', label: 'Assignada' },
            { color: '#f97316', label: 'En procés' },
            { color: '#22c55e', label: 'Validada' },
            { color: '#6b7280', label: 'Tancada' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-gray-600">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {viewMode === 'heatmap' && (
        <div className="mt-4 text-sm text-gray-500">
          {weightBy === 'priority' && 'Intensitat basada en la prioritat de cada incidència (Crítica = màxim pes).'}
          {weightBy === 'density' && 'Intensitat basada en la concentració de incidències (totes pesen igual).'}
          {weightBy === 'age' && 'Intensitat basada en l\'antiguitat (incidències cròniques = més pes).'}
        </div>
      )}
    </div>
  );
}

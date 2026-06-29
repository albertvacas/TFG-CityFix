import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { GeoJsonFeature } from '../../api/geo';

const stateColors: Record<string, string> = {
  OPEN: '#3b82f6',
  ASSIGNED: '#eab308',
  IN_PROGRESS: '#f97316',
  VALIDATED: '#22c55e',
  CLOSED: '#6b7280',
};

interface Props {
  features: GeoJsonFeature[];
  onFeatureClick?: (id: string) => void;
}

export default function MarkerClusterGroup({ features, onFeatureClick }: Props) {
  const map = useMap();
  const { t } = useTranslation();

  useEffect(() => {
    const cluster = (L as any).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });

    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      const color = stateColors[f.properties.state] || '#6b7280';

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width: 14px; height: 14px; border-radius: 50%;
          background: ${color}; border: 2px solid white;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const categoryLabel = f.properties.category
        ? t(`categories.${f.properties.category}`, { defaultValue: f.properties.category })
        : t('common.noCategory');

      const marker = L.marker([lat, lng], { icon }).bindPopup(`
        <div style="min-width: 200px;">
          <strong>${f.properties.title}</strong><br/>
          <span style="color: ${color}; font-weight: 600;">${t(`stateBadge.${f.properties.state}`, { defaultValue: f.properties.state })}</span>
          · ${t(`priorities.${f.properties.priority}`, { defaultValue: f.properties.priority })}<br/>
          <span style="color: #6b7280; font-size: 12px;">${categoryLabel}</span><br/>
          <span style="color: #9ca3af; font-size: 11px;">${new Date(f.properties.createdAt).toLocaleDateString('ca-ES')}</span>
        </div>
      `);

      if (onFeatureClick) {
        marker.on('click', () => onFeatureClick(f.properties.id));
      }

      cluster.addLayer(marker);
    }

    map.addLayer(cluster);
    return () => { map.removeLayer(cluster); };
  }, [features, map, onFeatureClick]);

  return null;
}

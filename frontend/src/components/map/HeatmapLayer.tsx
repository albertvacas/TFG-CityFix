import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import type { HeatmapPoint } from '../../api/geo';

interface Props {
  points: HeatmapPoint[];
  radius?: number;
  blur?: number;
  maxZoom?: number;
}

export default function HeatmapLayer({ points, radius = 25, blur = 15, maxZoom = 17 }: Props) {
  const map = useMap();

  useEffect(() => {
    const heatData: [number, number, number][] = points.map((p) => [p.lat, p.lng, p.weight]);

    const heat = (L as any).heatLayer(heatData, {
      radius,
      blur,
      maxZoom,
      gradient: {
        0.2: '#2563eb',
        0.4: '#22d3ee',
        0.6: '#22c55e',
        0.8: '#eab308',
        1.0: '#ef4444',
      },
    });

    map.addLayer(heat);
    return () => { map.removeLayer(heat); };
  }, [points, map, radius, blur, maxZoom]);

  return null;
}

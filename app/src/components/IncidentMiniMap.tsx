import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { STATE_COLORS } from '../mocks/reports';
import type { ReportState } from '../types';

interface Props {
  latitude: number;
  longitude: number;
  state: ReportState;
  height?: number;
}

const buildHtml = (lat: number, lng: number, color: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: #e5e7eb; }
    #map { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #e5e7eb; }
    .pin {
      width: 22px; height: 22px; border-radius: 11px;
      border: 3px solid #ffffff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    }
    .leaflet-control-attribution { font-size: 8px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    function init() {
      var center = [${lat}, ${lng}];
      var map = L.map('map', { zoomControl: false, attributionControl: true }).setView(center, 17);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OSM'
      }).addTo(map);
      var icon = L.divIcon({
        className: '',
        html: '<div class="pin" style="background:${color}"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker(center, { icon: icon }).addTo(map);
      function refresh() { try { map.invalidateSize(); } catch (e) {} }
      setTimeout(refresh, 0);
      setTimeout(refresh, 100);
      setTimeout(refresh, 400);
      window.addEventListener('resize', refresh);
    }
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
  </script>
</body>
</html>
`;

export function IncidentMiniMap({ latitude, longitude, state, height = 180 }: Props) {
  const color = STATE_COLORS[state].dot;
  return (
    <View
      style={{
        height,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#e5e7eb',
      }}
    >
      <WebView
        originWhitelist={['*']}
        source={{ html: buildHtml(latitude, longitude, color), baseUrl: 'https://cdn.jsdelivr.net/' }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#e5e7eb',
        }}
      />
    </View>
  );
}

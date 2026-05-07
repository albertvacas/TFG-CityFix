import { useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

interface Coords {
  latitude: number;
  longitude: number;
}

interface Props {
  initialCoords?: Coords | null;
  onChange: (coords: Coords) => void;
  height?: number;
}

const UAB_CENTER: Coords = { latitude: 41.5025, longitude: 2.106 };

const buildHtml = (initial: Coords) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: #e5e7eb; }
    #map { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #e5e7eb; }
    .picker-pin {
      width: 26px; height: 26px; border-radius: 13px;
      background: #1d4ed8;
      border: 3px solid #ffffff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    #hint {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.7); color: #fff; font: 11px sans-serif;
      padding: 4px 10px; border-radius: 12px; z-index: 9999;
      pointer-events: none;
    }
    .leaflet-control-attribution { font-size: 8px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="hint">Toca el mapa per col·locar el marcador</div>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    function post(msg) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
    }
    function init() {
      var center = [${initial.latitude}, ${initial.longitude}];
      var map = L.map('map', { zoomControl: false, attributionControl: true }).setView(center, 17);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OSM'
      }).addTo(map);

      var icon = L.divIcon({
        className: '',
        html: '<div class="picker-pin"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      // Marcador inicial draggable
      var marker = L.marker(center, { icon: icon, draggable: true }).addTo(map);
      marker.on('dragend', function() {
        var ll = marker.getLatLng();
        post({ type: 'change', latitude: ll.lat, longitude: ll.lng });
      });

      // Tap al mapa per moure el marcador
      map.on('click', function(e) {
        marker.setLatLng(e.latlng);
        post({ type: 'change', latitude: e.latlng.lat, longitude: e.latlng.lng });
      });

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

export function LocationPicker({ initialCoords, onChange, height = 240 }: Props) {
  const webviewRef = useRef<WebView | null>(null);
  // Important: capturem l'inicial al primer render perquè el HTML és estàtic
  // (no volem regenerar tot el WebView cada cop que canvien les coords).
  const startCoords = useRef<Coords>(initialCoords ?? UAB_CENTER).current;

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'change' && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        onChange({ latitude: data.latitude, longitude: data.longitude });
      }
    } catch {
      // ignore
    }
  };

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
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: buildHtml(startCoords), baseUrl: 'https://cdn.jsdelivr.net/' }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
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

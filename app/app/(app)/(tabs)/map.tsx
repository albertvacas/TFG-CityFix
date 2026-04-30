import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, SafeAreaView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  CATEGORY_IONICONS,
  CATEGORY_LABELS,
  PRIORITY_WEIGHTS,
  STATE_COLORS,
  STATE_LABELS,
} from '../../../src/mocks/reports';
import { useReports } from '../../../src/hooks/useReports';
import type { Report, ReportState } from '../../../src/types';

type ViewMode = 'markers' | 'heatmap';

const FILTERS: { key: 'ALL' | ReportState; label: string }[] = [
  { key: 'ALL', label: 'Totes' },
  { key: 'OPEN', label: 'Obertes' },
  { key: 'IN_PROGRESS', label: 'En curs' },
  { key: 'CLOSED', label: 'Resoltes' },
];

const STATE_LEGEND: { state: ReportState; label: string }[] = [
  { state: 'OPEN', label: 'Oberta' },
  { state: 'ASSIGNED', label: 'Assignada' },
  { state: 'IN_PROGRESS', label: 'En procés' },
  { state: 'VALIDATED', label: 'Validada' },
  { state: 'CLOSED', label: 'Tancada' },
];

const UAB_CENTER = { latitude: 41.5025, longitude: 2.1060 };

const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: #e5e7eb; }
    #map { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #e5e7eb; }
    .pin {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid #ffffff;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    .leaflet-control-attribution { font-size: 9px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
  <script>
    function post(msg) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
    }

    var map, markerCluster, heatLayer;
    var CENTER = [${UAB_CENTER.latitude}, ${UAB_CENTER.longitude}];

    function init() {
      map = L.map('map', { zoomControl: false }).setView(CENTER, 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OSM'
      }).addTo(map);

      window.__renderMarkers = function(reports) {
        if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
        if (markerCluster) { map.removeLayer(markerCluster); }
        markerCluster = L.markerClusterGroup({
          chunkedLoading: true,
          maxClusterRadius: 50,
          showCoverageOnHover: false,
        });
        reports.forEach(function(r) {
          var icon = L.divIcon({
            className: '',
            html: '<div class="pin" style="background:' + r.color + '"></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          var marker = L.marker([r.lat, r.lng], { icon: icon });
          marker.on('click', function() { post({ type: 'select', id: r.id }); });
          markerCluster.addLayer(marker);
        });
        map.addLayer(markerCluster);
      };

      window.__renderHeatmap = function(points) {
        if (markerCluster) { map.removeLayer(markerCluster); markerCluster = null; }
        if (heatLayer) { map.removeLayer(heatLayer); }
        var data = points.map(function(p) { return [p.lat, p.lng, p.weight]; });
        heatLayer = L.heatLayer(data, {
          radius: 28,
          blur: 18,
          maxZoom: 17,
          gradient: {
            0.2: '#2563eb',
            0.4: '#22d3ee',
            0.6: '#22c55e',
            0.8: '#eab308',
            1.0: '#ef4444',
          },
        });
        map.addLayer(heatLayer);
      };

      window.__recenter = function() {
        map.setView(CENTER, 16, { animate: true });
      };

      function refresh() { try { map.invalidateSize(); } catch (e) {} }
      setTimeout(refresh, 0);
      setTimeout(refresh, 100);
      setTimeout(refresh, 400);
      window.addEventListener('resize', refresh);

      post({ type: 'ready' });
    }

    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
  </script>
</body>
</html>
`;

export default function MapScreen() {
  const { reports, loading } = useReports();
  const [filter, setFilter] = useState<'ALL' | ReportState>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('markers');
  const [selected, setSelected] = useState<Report | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const webviewRef = useRef<WebView | null>(null);

  const visibleReports = useMemo(
    () => (filter === 'ALL' ? reports : reports.filter((r) => r.state === filter)),
    [filter, reports],
  );

  useEffect(() => {
    if (!mapReady) return;
    if (viewMode === 'markers') {
      const payload = visibleReports.map((r) => ({
        id: r.report_id,
        lat: r.latitude,
        lng: r.longitude,
        color: STATE_COLORS[r.state].dot,
      }));
      webviewRef.current?.injectJavaScript(
        `window.__renderMarkers(${JSON.stringify(payload)}); true;`,
      );
    } else {
      const payload = visibleReports.map((r) => ({
        lat: r.latitude,
        lng: r.longitude,
        weight: PRIORITY_WEIGHTS[r.priority],
      }));
      webviewRef.current?.injectJavaScript(
        `window.__renderHeatmap(${JSON.stringify(payload)}); true;`,
      );
    }
  }, [mapReady, visibleReports, viewMode]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'ready') {
        setMapReady(true);
      } else if (data.type === 'select') {
        const r = reports.find((x) => x.report_id === data.id);
        if (r) setSelected(r);
      }
    } catch {
      // ignore
    }
  };

  const recenter = () => {
    webviewRef.current?.injectJavaScript('window.__recenter(); true;');
  };

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      {/* Header + filtres + toggle */}
      <View className="px-5 pt-4 pb-3 bg-white border-b border-gray-100">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-2xl font-bold text-gray-900">Mapa del campus</Text>
          <Text className="text-xs text-gray-500">
            {loading ? 'Carregant…' : `${visibleReports.length} ${visibleReports.length === 1 ? 'punt' : 'punts'}`}
          </Text>
        </View>

        {/* View mode toggle */}
        <View className="flex-row mb-3 self-start rounded-lg overflow-hidden border border-gray-200">
          <ToggleButton
            label="Markers"
            icon="location-outline"
            active={viewMode === 'markers'}
            onPress={() => setViewMode('markers')}
          />
          <ToggleButton
            label="Mapa de calor"
            icon="flame-outline"
            active={viewMode === 'heatmap'}
            onPress={() => setViewMode('heatmap')}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                className="rounded-full px-4 py-2"
                style={{ backgroundColor: filter === f.key ? '#1d4ed8' : '#f3f4f6' }}
              >
                <Text className="text-sm font-semibold" style={{ color: filter === f.key ? '#ffffff' : '#374151' }}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Mapa */}
      <View style={{ flex: 1 }}>
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html: LEAFLET_HTML, baseUrl: 'https://cdn.jsdelivr.net/' }}
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

        {/* Llegenda d'estats (només en mode markers) */}
        {viewMode === 'markers' && (
          <View
            className="absolute top-3 left-4 right-4 rounded-2xl bg-white/95 p-3"
            style={{
              shadowColor: '#000',
              shadowOpacity: 0.1,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3,
            }}
          >
            <Text className="text-xs font-semibold text-gray-700 mb-2">Estat</Text>
            <View className="flex-row flex-wrap gap-3">
              {STATE_LEGEND.map(({ state, label }) => (
                <View key={state} className="flex-row items-center">
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: STATE_COLORS[state].dot,
                      marginRight: 6,
                    }}
                  />
                  <Text className="text-xs text-gray-600">{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Botó "centrar" */}
        <Pressable
          onPress={recenter}
          className="absolute right-4 rounded-full bg-white w-12 h-12 items-center justify-center"
          style={{
            bottom: 220,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}
        >
          <Ionicons name="locate-outline" size={22} color="#1d4ed8" />
        </Pressable>
      </View>

      {/* Bottom sheet del pin seleccionat */}
      {selected && (
        <Pressable
          onPress={() => router.push(`/incident/${selected.report_id}`)}
          className="absolute left-4 right-4 rounded-2xl bg-white p-4 border border-gray-200"
          style={{
            bottom: 130,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          <View className="flex-row items-center justify-between mb-1">
            <Text className="text-base font-semibold text-gray-900 flex-1 pr-2" numberOfLines={1}>
              {selected.title}
            </Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={10} className="ml-2">
              <Ionicons name="close" size={20} color="#9ca3af" />
            </Pressable>
          </View>
          <View className="flex-row items-center mb-2">
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: STATE_COLORS[selected.state].dot,
                marginRight: 6,
              }}
            />
            <Text className="text-xs text-gray-500">{STATE_LABELS[selected.state]}</Text>
            {selected.category && (
              <>
                <Text className="text-xs text-gray-400 mx-2">·</Text>
                <Ionicons
                  name={CATEGORY_IONICONS[selected.category]}
                  size={12}
                  color="#6b7280"
                  style={{ marginRight: 4 }}
                />
                <Text className="text-xs text-gray-500">{CATEGORY_LABELS[selected.category]}</Text>
              </>
            )}
          </View>
          <Text className="text-sm text-brand-600 font-semibold">Veure detall →</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function ToggleButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: active ? '#1d4ed8' : '#ffffff',
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Ionicons name={icon} size={14} color={active ? '#ffffff' : '#6b7280'} />
      <Text style={{ color: active ? '#ffffff' : '#374151', fontSize: 12, fontWeight: '600', marginLeft: 6 }}>
        {label}
      </Text>
    </Pressable>
  );
}

import { useMemo, useState } from 'react';
import { View, Text, ScrollView, SafeAreaView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/context/AuthContext';
import { getReportsByRole, STATE_LABELS } from '../../../src/mocks/reports';
import { useReports } from '../../../src/hooks/useReports';
import { ReportCard } from '../../../src/components/ReportCard';
import type { ReportState } from '../../../src/types';

const STATE_FILTERS: { key: 'ALL' | ReportState; label: string }[] = [
  { key: 'ALL', label: 'Totes' },
  { key: 'OPEN', label: STATE_LABELS.OPEN },
  { key: 'ASSIGNED', label: STATE_LABELS.ASSIGNED },
  { key: 'IN_PROGRESS', label: STATE_LABELS.IN_PROGRESS },
  { key: 'VALIDATED', label: STATE_LABELS.VALIDATED },
  { key: 'CLOSED', label: STATE_LABELS.CLOSED },
];

export default function ReportsScreen() {
  const { user } = useAuth();
  const { reports, loading, error, refresh } = useReports();
  const [filter, setFilter] = useState<'ALL' | ReportState>('ALL');

  const baseReports = useMemo(() => {
    if (!user) return [];
    return getReportsByRole(reports, user.role, user.nickname);
  }, [reports, user]);

  const filteredReports = useMemo(
    () => (filter === 'ALL' ? baseReports : baseReports.filter((r) => r.state === filter)),
    [baseReports, filter],
  );

  if (!user) return null;

  const title =
    user.role === 'STUDENT'
      ? 'Les meves incidències'
      : user.role === 'TECHNICAL'
      ? 'Incidències assignades'
      : 'Totes les incidències';

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      <View className="px-5 pt-4 pb-3 bg-white border-b border-gray-100">
        <Text className="text-2xl font-bold text-gray-900 mb-3">{title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {STATE_FILTERS.map((f) => (
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

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      >
        {error && (
          <View className="rounded-xl bg-red-50 border border-red-200 p-3 mb-4 flex-row items-center">
            <Ionicons name="alert-circle-outline" size={18} color="#b91c1c" />
            <Text className="text-xs text-red-700 ml-2 flex-1">{error}</Text>
          </View>
        )}
        <Text className="text-xs text-gray-500 mb-3">
          {filteredReports.length} {filteredReports.length === 1 ? 'incidència' : 'incidències'}
        </Text>
        {loading && filteredReports.length === 0 ? (
          <ActivityIndicator color="#1d4ed8" style={{ marginTop: 24 }} />
        ) : filteredReports.length === 0 ? (
          <View className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 items-center mt-4">
            <Ionicons name="file-tray-outline" size={32} color="#9ca3af" />
            <Text className="text-sm text-gray-500 text-center mt-2">
              No hi ha incidències
              {filter !== 'ALL' ? ` amb l'estat "${STATE_LABELS[filter as ReportState]}"` : ''}.
            </Text>
          </View>
        ) : (
          filteredReports.map((r) => <ReportCard key={r.report_id} report={r} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

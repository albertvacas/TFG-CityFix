import { useMemo, useState } from 'react';
import { View, Text, ScrollView, SafeAreaView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useColorScheme } from 'nativewind';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/context/AuthContext';
import { getReportsByRole } from '../../../src/mocks/reports';
import { useReports } from '../../../src/hooks/useReports';
import { ReportCard } from '../../../src/components/ReportCard';
import type { ReportState } from '../../../src/types';

const STATE_FILTERS: { key: 'ALL' | ReportState; labelKey: string }[] = [
  { key: 'ALL', labelKey: 'reportsList.filterAll' },
  { key: 'OPEN', labelKey: 'states.OPEN' },
  { key: 'ASSIGNED', labelKey: 'states.ASSIGNED' },
  { key: 'IN_PROGRESS', labelKey: 'states.IN_PROGRESS' },
  { key: 'VALIDATED', labelKey: 'states.VALIDATED' },
  { key: 'CLOSED', labelKey: 'states.CLOSED' },
];

export default function ReportsScreen() {
  const { user } = useAuth();
  const { reports, loading, error, refresh } = useReports();
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | ReportState>('ALL');
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const chipBg = (active: boolean) => (active ? '#15803d' : isDark ? '#334155' : '#f3f4f6');
  const chipText = (active: boolean) => (active ? '#ffffff' : isDark ? '#cbd5e1' : '#6b7280');

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
      ? t('reportsList.titleMine')
      : user.role === 'TECHNICAL'
      ? t('reportsList.titleAssigned')
      : t('reportsList.titleAll');

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      <View className="px-5 pt-4 pb-3 border-b border-gray-100">
        <Text className="text-2xl font-bold text-gray-900 mb-3">{title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {STATE_FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                className="rounded-full px-4 py-2"
                style={{ backgroundColor: chipBg(filter === f.key) }}
              >
                <Text className="text-sm font-semibold" style={{ color: chipText(filter === f.key) }}>
                  {t(f.labelKey)}
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
          {filteredReports.length === 1
            ? t('reportsList.countOne', { count: filteredReports.length })
            : t('reportsList.countMany', { count: filteredReports.length })}
        </Text>
        {loading && filteredReports.length === 0 ? (
          <ActivityIndicator color="#15803d" style={{ marginTop: 24 }} />
        ) : filteredReports.length === 0 ? (
          <View className="rounded-2xl border border-dashed border-gray-300 bg-surface p-8 items-center mt-4">
            <Ionicons name="file-tray-outline" size={32} color="#9ca3af" />
            <Text className="text-sm text-gray-500 text-center mt-2">
              {t('reportsList.empty')}
              {filter !== 'ALL' ? t('reportsList.emptyWithState', { state: t(`states.${filter}`) }) : ''}.
            </Text>
          </View>
        ) : (
          filteredReports.map((r) => <ReportCard key={r.report_id} report={r} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

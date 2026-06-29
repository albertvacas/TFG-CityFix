import { View, Text, ScrollView, SafeAreaView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/context/AuthContext';
import { useReports } from '../../../src/hooks/useReports';
import { getReportsByRole } from '../../../src/mocks/reports';
import { ReportCard } from '../../../src/components/ReportCard';
import type { Report } from '../../../src/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export default function HomeScreen() {
  const { user } = useAuth();
  const { reports, loading, error, refresh } = useReports();
  const { t } = useTranslation();
  if (!user) return null;

  const myReports = getReportsByRole(reports, user.role, user.nickname);

  const roleIcon: IoniconName =
    user.role === 'STUDENT'
      ? 'school-outline'
      : user.role === 'TECHNICAL'
      ? 'construct-outline'
      : 'shield-checkmark-outline';

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      >
        {/* Header */}
        <View className="mb-6 flex-row items-center justify-between">
          <View>
            <Text className="text-sm text-gray-500">{t(greetingKey())}</Text>
            <Text className="text-2xl font-bold text-gray-900">{user.name}</Text>
          </View>
          <Ionicons name={roleIcon} size={26} color="#15803d" />
        </View>

        {error && (
          <View className="rounded-xl bg-red-50 border border-red-200 p-3 mb-4 flex-row items-center">
            <Ionicons name="alert-circle-outline" size={18} color="#b91c1c" />
            <Text className="text-xs text-red-700 ml-2 flex-1">{error}</Text>
          </View>
        )}

        {user.role === 'STUDENT' && <StudentHome points={user.points} reports={myReports} loading={loading} />}
        {user.role === 'TECHNICAL' && <TechnicalHome reports={myReports} loading={loading} />}
        {user.role === 'ADMIN' && <AdminHome reports={reports} loading={loading} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function greetingKey() {
  const h = new Date().getHours();
  if (h < 13) return 'home.greetingMorning';
  if (h < 20) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

function StudentHome({ points, reports, loading }: { points: number; reports: Report[]; loading: boolean }) {
  const { t } = useTranslation();
  // Reports en VALIDATED creats per l'estudiant: el tècnic les ha marcat com a resoltes,
  // però l'admin encara no les ha tancades. Convidem l'estudiant a revisar-les.
  const pendingReview = reports.filter((r) => r.state === 'VALIDATED');

  return (
    <>
      <View className="rounded-2xl bg-brand-600 p-5 mb-5">
        <Text className="text-white/80 text-sm">{t('home.yourPoints')}</Text>
        <View className="flex-row items-center mt-1">
          <Ionicons name="trophy-outline" size={26} color="#ffffff" />
          <Text className="text-white text-3xl font-bold ml-2">{points}</Text>
        </View>
        <Text className="text-white/80 text-xs mt-2">
          {t('home.pointsHint')}
        </Text>
      </View>

      <Text className="text-sm font-semibold text-gray-700 mb-2">{t('home.quickActions')}</Text>
      <View className="flex-row gap-3 mb-6">
        <QuickAction icon="add-circle-outline" label={t('home.report')} onPress={() => router.push('/create')} />
        <QuickAction icon="map-outline" label={t('home.map')} onPress={() => router.push('/map')} />
      </View>

      {/* Per revisar: el tècnic ha marcat la incidència com a resolta, l'estudiant
          pot afegir un comentari abans que l'admin la tanqui. */}
      {pendingReview.length > 0 && (
        <>
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center">
              <Ionicons name="alert-circle-outline" size={18} color="#059669" />
              <Text className="text-sm font-semibold text-emerald-700 ml-1.5">
                {t('home.toReview', { count: pendingReview.length })}
              </Text>
            </View>
          </View>
          <View className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 mb-2">
            <Text className="text-xs text-emerald-700 leading-4">
              {pendingReview.length === 1
                ? t('home.toReviewOne')
                : t('home.toReviewMany', { count: pendingReview.length })}
            </Text>
          </View>
          {pendingReview.slice(0, 3).map((r) => <ReportCard key={r.report_id} report={r} />)}
          <View className="h-3" />
        </>
      )}

      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-semibold text-gray-700">{t('home.myIncidents', { count: reports.length })}</Text>
        <Pressable onPress={() => router.push('/reports')}>
          <Text className="text-sm font-semibold text-brand-600">{t('home.seeAll')}</Text>
        </Pressable>
      </View>
      {loading && reports.length === 0 ? (
        <ActivityIndicator color="#15803d" style={{ marginTop: 12 }} />
      ) : reports.length === 0 ? (
        <EmptyState icon="document-text-outline" message={t('home.emptyReports')} />
      ) : (
        reports.slice(0, 3).map((r) => <ReportCard key={r.report_id} report={r} />)
      )}
    </>
  );
}

function TechnicalHome({ reports, loading }: { reports: Report[]; loading: boolean }) {
  const { t } = useTranslation();
  const pending = reports.filter((r) => r.state === 'ASSIGNED').length;
  const inProgress = reports.filter((r) => r.state === 'IN_PROGRESS').length;
  const resolvedToday = reports.filter((r) => r.state === 'VALIDATED' || r.state === 'CLOSED').length;

  const upcoming = [...reports]
    .filter((r) => r.state === 'ASSIGNED' || r.state === 'IN_PROGRESS')
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));

  return (
    <>
      <Text className="text-base font-semibold text-gray-800 mb-1">
        {reports.length === 1
          ? t('home.assignedCountOne', { count: reports.length })
          : t('home.assignedCountMany', { count: reports.length })}
      </Text>

      <View className="rounded-2xl bg-surface border border-gray-100 p-5 mb-5">
        <Text className="text-sm font-semibold text-gray-700 mb-3">{t('home.yourWorkload')}</Text>
        <WorkloadRow label={t('home.pending')} value={pending} color="#eab308" />
        <WorkloadRow label={t('home.inProgress')} value={inProgress} color="#3b82f6" />
        <WorkloadRow label={t('home.recentResolved')} value={resolvedToday} color="#10b981" />
      </View>

      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-semibold text-gray-700">{t('home.toAttend')}</Text>
        <Pressable onPress={() => router.push('/reports')}>
          <Text className="text-sm font-semibold text-brand-600">{t('home.all')}</Text>
        </Pressable>
      </View>
      {loading && upcoming.length === 0 ? (
        <ActivityIndicator color="#15803d" style={{ marginTop: 12 }} />
      ) : upcoming.length === 0 ? (
        <EmptyState icon="checkmark-circle-outline" message={t('home.noPending')} />
      ) : (
        upcoming.slice(0, 3).map((r) => <ReportCard key={r.report_id} report={r} />)
      )}
    </>
  );
}

function AdminHome({ reports, loading }: { reports: Report[]; loading: boolean }) {
  const { t } = useTranslation();
  const total = reports.length;
  const open = reports.filter((r) => r.state === 'OPEN').length;
  const critical = reports.filter((r) => r.priority === 'CRITICAL').length;
  const unassigned = reports.filter((r) => r.state === 'OPEN').length;

  return (
    <>
      <View className="flex-row gap-3 mb-5">
        <StatCard label={t('home.total')} value={total} color="#15803d" />
        <StatCard label={t('home.open')} value={open} color="#eab308" />
      </View>
      <View className="flex-row gap-3 mb-6">
        <StatCard label={t('home.critical')} value={critical} color="#dc2626" />
        <StatCard label={t('home.unassigned')} value={unassigned} color="#6b7280" />
      </View>

      <View className="rounded-2xl border border-dashed border-gray-300 bg-surface p-5 mb-5">
        <Text className="text-sm font-semibold text-gray-700 mb-1">{t('home.webMgmtTitle')}</Text>
        <Text className="text-xs text-gray-500">
          {t('home.webMgmtBody')}
        </Text>
      </View>

      <Text className="text-sm font-semibold text-gray-700 mb-2">{t('home.recentIncidents')}</Text>
      {loading && reports.length === 0 ? (
        <ActivityIndicator color="#15803d" style={{ marginTop: 12 }} />
      ) : (
        reports.slice(0, 4).map((r) => <ReportCard key={r.report_id} report={r} />)
      )}
    </>
  );
}

function QuickAction({ icon, label, onPress }: { icon: IoniconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-2xl bg-surface border border-gray-100 p-5 items-center active:bg-gray-50"
    >
      <Ionicons name={icon} size={28} color="#15803d" />
      <Text className="text-sm font-semibold text-gray-800 mt-1">{label}</Text>
    </Pressable>
  );
}

function WorkloadRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <View className="flex-row items-center">
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 10 }} />
        <Text className="text-sm text-gray-700">{label}</Text>
      </View>
      <Text className="text-base font-semibold" style={{ color }}>{value}</Text>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-1 rounded-2xl bg-surface border border-gray-100 p-4">
      <Text className="text-xs text-gray-500">{label}</Text>
      <Text className="text-2xl font-bold mt-1" style={{ color }}>{value}</Text>
    </View>
  );
}

function EmptyState({ icon, message }: { icon: IoniconName; message: string }) {
  return (
    <View className="rounded-2xl border border-dashed border-gray-300 bg-surface p-6 items-center">
      <Ionicons name={icon} size={28} color="#9ca3af" />
      <Text className="text-sm text-gray-500 mt-2">{message}</Text>
    </View>
  );
}

function priorityRank(p: string): number {
  return ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as Record<string, number>)[p] ?? 0;
}

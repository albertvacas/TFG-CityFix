import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  SafeAreaView,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../../src/context/AuthContext';
import { useReports } from '../../../src/hooks/useReports';
import { getReportsByRole } from '../../../src/mocks/reports';
import { getMyPoints } from '../../../src/api/gamification';
import { getProfile, uploadAvatar } from '../../../src/api/auth';
import Avatar from '../../../src/components/Avatar';
import type { PointsTransactionItem, UserRank } from '../../../src/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ROLE_INFO: Record<string, { labelKey: string; icon: IoniconName }> = {
  STUDENT: { labelKey: 'profile.studentLabel', icon: 'school-outline' },
  TECHNICAL: { labelKey: 'profile.technicalLabel', icon: 'construct-outline' },
  ADMIN: { labelKey: 'profile.adminLabel', icon: 'shield-checkmark-outline' },
};

export default function ProfileScreen() {
  const { user, logout, setUser } = useAuth();
  const { t } = useTranslation();
  const { reports, refresh: refreshReports } = useReports();
  const [pointsHistory, setPointsHistory] = useState<PointsTransactionItem[]>([]);
  const [rank, setRank] = useState<UserRank | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Refresca l'historial de punts. Cridat tant en muntar la pantalla com en
  // pull-to-refresh. Per a no-estudiants és un no-op.
  const loadPoints = useCallback(async () => {
    if (user?.role !== 'STUDENT') return;
    try {
      const data = await getMyPoints();
      setPointsHistory(data.history);
      setRank(data.rank);
    } catch {
      // Silenciat: si falla, mantenim l'estat anterior.
    }
  }, [user?.role]);

  // Càrrega inicial — i recàrrega quan canvia user.points (per exemple, en
  // rebre un push POINTS_EARNED que dispara una refetch via AuthContext).
  useEffect(() => {
    loadPoints();
  }, [loadPoints, user?.points]);

  // Pull-to-refresh: actualitza el perfil (per refrescar `user.points` al
  // AuthContext), l'historial de punts i la llista de reports. En paral·lel
  // perquè cada crida sigui independent — si una falla, les altres avancen.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        getProfile()
          .then((profile) => setUser(profile))
          .catch(() => {}),
        loadPoints(),
        refreshReports(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [setUser, loadPoints, refreshReports]);

  // Puja una nova foto de perfil des de càmera o galeria.
  const pickAndUpload = useCallback(
    async (source: 'camera' | 'library') => {
      try {
        const perm =
          source === 'camera'
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert(t('profile.permissionDenied'), t('profile.permissionBody'));
          return;
        }
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] })
            : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
        if (result.canceled || !result.assets?.[0]?.uri) return;

        setUploadingAvatar(true);
        const updated = await uploadAvatar(result.assets[0].uri);
        setUser(updated);
      } catch (e: any) {
        Alert.alert(t('profile.errorTitle'), e?.response?.data?.error ?? e?.message ?? t('profile.avatarError'));
      } finally {
        setUploadingAvatar(false);
      }
    },
    [setUser, t],
  );

  const changeAvatar = useCallback(() => {
    Alert.alert(t('profile.photoTitle'), t('profile.photoSubtitle'), [
      { text: t('profile.takePhoto'), onPress: () => pickAndUpload('camera') },
      { text: t('profile.pickGallery'), onPress: () => pickAndUpload('library') },
      { text: t('profile.cancel'), style: 'cancel' },
    ]);
  }, [pickAndUpload, t]);

  if (!user) return null;

  const info = ROLE_INFO[user.role];
  const myReports = getReportsByRole(reports, user.role, user.nickname);
  const resolved = myReports.filter((r) => r.state === 'VALIDATED' || r.state === 'CLOSED').length;

  const confirmLogout = () => {
    Alert.alert(
      t('profile.logout'),
      t('profile.logoutBody'),
      [
        { text: t('profile.cancel'), style: 'cancel' },
        { text: t('profile.exit'), style: 'destructive', onPress: () => logout() },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Avatar + nom */}
        <View className="items-center mb-6 mt-4">
          <Pressable onPress={changeAvatar} disabled={uploadingAvatar} className="mb-3 active:opacity-80">
            <Avatar name={user.name} surname={user.surname} uri={user.avatarUrl} size={96} />
            <View className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-brand-600 items-center justify-center border-2 border-white">
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="camera" size={16} color="#ffffff" />
              )}
            </View>
          </Pressable>
          <Text className="text-xl font-bold text-gray-900">
            {user.name} {user.surname}
          </Text>
          <Text className="text-sm text-gray-500">@{user.nickname}</Text>
          <View className="mt-2 flex-row items-center bg-brand-100 rounded-full px-3 py-1">
            <Ionicons name={info.icon} size={14} color="#15803d" />
            <Text className="text-xs font-semibold text-brand-700 ml-1.5">{t(info.labelKey)}</Text>
          </View>
        </View>

        {/* Stats */}
        <View className="rounded-2xl bg-surface border border-gray-100 p-5 mb-5">
          {user.role === 'STUDENT' && (
            <>
              <StatLine icon="trophy-outline" label={t('profile.points')} value={String(user.points)} color="#15803d" />
              <Divider />
              <StatLine icon="document-text-outline" label={t('profile.reportedIncidents')} value={String(myReports.length)} />
              <Divider />
              <StatLine icon="checkmark-done-outline" label={t('profile.resolvedThanks')} value={String(resolved)} color="#059669" />
            </>
          )}
          {user.role === 'TECHNICAL' && (
            <>
              <StatLine icon="briefcase-outline" label={t('profile.assignedIncidents')} value={String(myReports.length)} color="#15803d" />
              <Divider />
              <StatLine icon="checkmark-done-outline" label={t('profile.resolved')} value={String(resolved)} color="#059669" />
            </>
          )}
          {user.role === 'ADMIN' && (
            <>
              <StatLine icon="shield-checkmark-outline" label={t('profile.adminLabel')} value={t('profile.adminFullAccess')} color="#15803d" />
              <Divider />
              <StatLine icon="globe-outline" label={t('profile.advancedMgmt')} value={t('profile.webDashboard')} />
            </>
          )}
        </View>

        {/* Dades */}
        <Text className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-2">{t('profile.accountData')}</Text>
        <View className="rounded-2xl bg-surface border border-gray-100 mb-5">
          <DataRow label={t('profile.emailLabel')} value={user.email} />
          <Divider />
          <DataRow label={t('profile.memberSince')} value={new Date(user.createdAt).toLocaleDateString('ca-ES')} />
        </View>

        {/* Dades professionals (només tècnics) */}
        {user.role === 'TECHNICAL' && (
          <>
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-2">
              {t('profile.professionalData')}
            </Text>
            <View className="rounded-2xl bg-surface border border-gray-100 mb-5">
              <DataRow label={t('profile.position')} value={user.position ?? '—'} />
              <Divider />
              <DataRow label={t('profile.company')} value={user.company ?? '—'} />
              <Divider />
              <DataRow
                label={t('profile.scope')}
                value={user.workCategory ? t(`categories.${user.workCategory}`) : '—'}
              />
            </View>
          </>
        )}

        {/* Historial de punts (només estudiants) */}
        {user.role === 'STUDENT' && (
          <>
            <View className="flex-row items-center justify-between mb-2 mt-2">
              <Text className="text-xs font-semibold text-gray-500 uppercase">
                {t('profile.recentPoints')}
              </Text>
              {rank && (
                <Text className="text-xs text-gray-500">
                  {t('profile.rankPosition', { rank: rank.rank, total: rank.total })}
                </Text>
              )}
            </View>
            <View className="rounded-2xl bg-surface border border-gray-100 mb-5">
              {pointsHistory.length === 0 ? (
                <View className="px-4 py-5 items-center">
                  <Ionicons name="trophy-outline" size={22} color="#9ca3af" />
                  <Text className="text-xs text-gray-400 mt-1.5 text-center">
                    {t('profile.noPointsYet')}
                  </Text>
                </View>
              ) : (
                pointsHistory.slice(0, 5).map((tx, idx) => (
                  <View key={tx.id}>
                    <View className="flex-row items-center px-4 py-3">
                      <View className="w-8 h-8 rounded-full bg-brand-100 items-center justify-center mr-3">
                        <Ionicons name="trophy" size={14} color="#15803d" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          className="text-sm font-medium text-gray-900"
                          numberOfLines={1}
                        >
                          {tx.report.title}
                        </Text>
                        <Text className="text-xs text-gray-500">
                          {new Date(tx.createdAt).toLocaleDateString('ca-ES', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                          {tx.report.category
                            ? ' · ' + t(`categories.${tx.report.category}`)
                            : ''}
                        </Text>
                      </View>
                      <Text className="text-base font-bold text-brand-700">
                        +{tx.amount}
                      </Text>
                    </View>
                    {idx < Math.min(pointsHistory.length, 5) - 1 && (
                      <View className="h-px bg-gray-100 mx-4" />
                    )}
                  </View>
                ))
              )}
            </View>
            {pointsHistory.length > 0 && (
              <Pressable
                onPress={() => router.push('/leaderboard')}
                className="rounded-xl bg-surface border border-gray-200 py-3 mb-5 active:bg-gray-50 flex-row items-center justify-center"
              >
                <Ionicons name="trophy-outline" size={16} color="#15803d" />
                <Text className="text-sm font-semibold text-brand-700 ml-2">
                  {t('profile.seeRanking')}
                </Text>
              </Pressable>
            )}
          </>
        )}

        {/* Opcions */}
        <Text className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-2">{t('profile.settingsSection')}</Text>
        <View className="rounded-2xl bg-surface border border-gray-100 mb-6">
          <OptionRow
            icon="settings-outline"
            label={t('profile.settingsOption')}
            onPress={() => router.push('/settings')}
          />
          <Divider />
          <OptionRow
            icon="information-circle-outline"
            label={t('profile.about')}
            onPress={() => router.push('/about')}
          />
        </View>

        {/* Logout */}
        <Pressable
          onPress={confirmLogout}
          className="rounded-xl border border-red-200 bg-red-50 py-4 active:bg-red-100 flex-row items-center justify-center"
        >
          <Ionicons name="log-out-outline" size={18} color="#dc2626" />
          <Text className="text-base font-semibold text-red-600 ml-2">{t('profile.logout')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatLine({ icon, label, value, color }: { icon: IoniconName; label: string; value: string; color?: string }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <View className="flex-row items-center">
        <Ionicons name={icon} size={18} color={color ?? '#6b7280'} style={{ marginRight: 10 }} />
        <Text className="text-sm text-gray-700">{label}</Text>
      </View>
      <Text className="text-base font-semibold" style={{ color: color ?? '#111827' }}>{value}</Text>
    </View>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between items-center px-4 py-3">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm text-gray-900 font-medium flex-1 text-right ml-3" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function OptionRow({
  icon,
  label,
  trailing,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  trailing?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-3.5 active:bg-gray-50">
      <Ionicons name={icon} size={18} color="#6b7280" style={{ marginRight: 12 }} />
      <Text className="text-sm text-gray-800 flex-1">{label}</Text>
      {trailing && <Text className="text-sm text-gray-400 mr-2">{trailing}</Text>}
      <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
    </Pressable>
  );
}

function Divider() {
  return <View className="h-px bg-gray-100 mx-4" />;
}

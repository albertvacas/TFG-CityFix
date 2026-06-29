import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  SafeAreaView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/context/AuthContext';
import { getLeaderboard, getMyPoints } from '../../../src/api/gamification';
import { getProfile } from '../../../src/api/auth';
import Avatar from '../../../src/components/Avatar';
import type { LeaderboardEntry, UserRank } from '../../../src/types';
import { POINTS_BY_PRIORITY } from '../../../src/types';

/**
 * Pantalla de gamificació: rànquing global d'estudiants + posició personal.
 * Disponible per a tots els rols però el text "la teva posició" només té
 * sentit per a estudiants (que són els que acumulen punts). Per a tècnics i
 * admins, mostrem el podi sense la card personal.
 */
export default function LeaderboardScreen() {
  const { user, setUser } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<UserRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const tasks: Promise<unknown>[] = [
        getLeaderboard(20).then((lb) => setLeaderboard(lb)),
        // Refresquem el perfil per mantenir `user.points` del AuthContext
        // sincronitzat amb la BD — així la resta de pantalles (perfil, home)
        // veuen el nou total sense haver de relogar.
        getProfile()
          .then((profile) => setUser(profile))
          .catch(() => {}),
      ];
      if (user?.role === 'STUDENT') {
        tasks.push(getMyPoints().then((data) => setMyRank(data.rank)));
      }
      await Promise.all(tasks);
    } catch {
      // Errors silenciats — pantalla mostra estat buit si no hi ha dades.
    }
  }, [user?.role, setUser]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View className="mb-5">
          <Text className="text-2xl font-bold text-gray-900">Classificació</Text>
          <Text className="text-sm text-gray-500 mt-1">
            Els estudiants guanyen punts quan es resolen les seves incidències.
          </Text>
        </View>

        {/* Cerca d'usuaris */}
        <Pressable
          onPress={() => router.push('/users')}
          className="flex-row items-center rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 px-4 py-3 mb-5 active:opacity-80"
        >
          <Ionicons name="search-outline" size={18} color="#15803d" />
          <Text className="text-sm font-semibold text-gray-700 dark:text-slate-200 ml-2 flex-1">
            Cerca usuaris
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
        </Pressable>

        {/* La meva posició (només estudiants) */}
        {user?.role === 'STUDENT' && myRank && (
          <View className="rounded-2xl bg-brand-600 p-5 mb-5">
            <Text className="text-xs font-semibold uppercase text-brand-100 mb-1">
              La teva posició
            </Text>
            <View className="flex-row items-end justify-between mt-1">
              <View>
                <Text className="text-white text-4xl font-bold">
                  #{myRank.rank}
                </Text>
                <Text className="text-brand-100 text-xs mt-1">
                  de {myRank.total} estudiants
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-white text-3xl font-bold">
                  {myRank.points}
                </Text>
                <Text className="text-brand-100 text-xs">punts totals</Text>
              </View>
            </View>
          </View>
        )}

        {/* Escala de punts */}
        <View className="rounded-2xl bg-surface border border-gray-100 p-4 mb-5">
          <Text className="text-xs font-semibold text-gray-500 uppercase mb-3">
            Punts per criticalitat
          </Text>
          <View className="flex-row justify-between">
            <PriorityChip label="Baixa" points={POINTS_BY_PRIORITY.LOW} color="#9ca3af" />
            <PriorityChip label="Mitjana" points={POINTS_BY_PRIORITY.MEDIUM} color="#3b82f6" />
            <PriorityChip label="Alta" points={POINTS_BY_PRIORITY.HIGH} color="#f59e0b" />
            <PriorityChip label="Crítica" points={POINTS_BY_PRIORITY.CRITICAL} color="#dc2626" />
          </View>
        </View>

        {/* Podi */}
        <Text className="text-xs font-semibold text-gray-500 uppercase mb-2 ml-1">
          Top {leaderboard.length || ''}
        </Text>

        {loading ? (
          <View className="py-12 items-center">
            <ActivityIndicator color="#15803d" />
          </View>
        ) : leaderboard.length === 0 ? (
          <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-8 items-center">
            <Ionicons name="trophy-outline" size={36} color="#9ca3af" />
            <Text className="text-gray-500 mt-2 text-sm">
              Encara cap estudiant no té punts.
            </Text>
          </View>
        ) : (
          <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 overflow-hidden">
            {leaderboard.map((entry, idx) => {
              const isMe = entry.user_id === user?.user_id;
              return (
                <View key={entry.user_id}>
                  <View
                    className={`flex-row items-center px-4 py-3 ${
                      isMe ? 'bg-brand-50 dark:bg-brand-900/40' : ''
                    }`}
                  >
                    <View
                      style={{ backgroundColor: medalColor(idx) }}
                      className="w-7 h-7 rounded-full items-center justify-center mr-2"
                    >
                      <Text className="text-white font-bold text-xs">
                        {idx + 1}
                      </Text>
                    </View>
                    <View className="mr-3">
                      <Avatar name={entry.name} surname={entry.surname} uri={entry.avatarUrl} size={36} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text className="text-sm font-semibold text-gray-900">
                        {entry.name} {entry.surname}
                        {isMe && (
                          <Text className="text-xs font-medium text-brand-600"> · tu</Text>
                        )}
                      </Text>
                      <Text className="text-xs text-gray-500">@{entry.nickname}</Text>
                    </View>
                    <View className="flex-row items-center">
                      <Ionicons name="trophy" size={14} color="#15803d" />
                      <Text className="text-base font-bold text-brand-700 ml-1.5">
                        {entry.points}
                      </Text>
                    </View>
                  </View>
                  {idx < leaderboard.length - 1 && (
                    <View className="h-px bg-gray-100 dark:bg-slate-700 mx-4" />
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PriorityChip({
  label,
  points,
  color,
}: {
  label: string;
  points: number;
  color: string;
}) {
  return (
    <View className="items-center">
      <View
        style={{ backgroundColor: color + '20', borderColor: color }}
        className="border rounded-full px-3 py-1 mb-1"
      >
        <Text style={{ color }} className="text-xs font-semibold">
          {label}
        </Text>
      </View>
      <Text className="text-sm font-bold text-gray-900">+{points}</Text>
    </View>
  );
}

function medalColor(idx: number): string {
  if (idx === 0) return '#f59e0b'; // or
  if (idx === 1) return '#9ca3af'; // plata
  if (idx === 2) return '#b45309'; // bronze
  return '#cbd5e1';
}

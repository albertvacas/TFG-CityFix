import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { searchUsers } from '../../src/api/users';
import Avatar from '../../src/components/Avatar';
import type { UserSearchResult } from '../../src/types';

const PAGE_SIZE = 20;

export default function UserSearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);

  // Cerca amb un petit debounce perquè no es dispari a cada pulsació de tecla.
  // Sempre torna a la primera pàgina i reemplaça els resultats.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await searchUsers(query.trim(), 1, PAGE_SIZE);
        setResults(res.users);
        setTotal(res.total);
        setPage(1);
        setSearched(true);
      } catch {
        setResults([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  // Carrega la pàgina següent i l'afegeix als resultats actuals.
  const loadMore = async () => {
    if (loadingMore || results.length >= total) return;
    try {
      setLoadingMore(true);
      const next = page + 1;
      const res = await searchUsers(query.trim(), next, PAGE_SIZE);
      setResults((prev) => [...prev, ...res.users]);
      setTotal(res.total);
      setPage(next);
    } catch {
      // Silenciat: mantenim els resultats ja carregats.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50 dark:bg-slate-900">
      {/* Topbar */}
      <View className="flex-row items-center px-4 py-3 bg-surface dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700">
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-2 mr-2">
          <Ionicons name="arrow-back" size={22} color="#9ca3af" />
        </Pressable>
        <Text className="text-lg font-bold text-gray-900 dark:text-slate-100 flex-1">
          Cerca d'usuaris
        </Text>
      </View>

      <View className="px-4 pt-4">
        <View className="flex-row items-center rounded-xl border border-gray-300 dark:border-slate-600 bg-surface dark:bg-slate-800 px-3">
          <Ionicons name="search-outline" size={18} color="#9ca3af" />
          <TextInput
            className="flex-1 px-2 py-3 text-base text-gray-900 dark:text-slate-100"
            placeholder="Nom o cognoms…"
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {loading ? (
          <View className="py-12 items-center">
            <ActivityIndicator color="#15803d" />
          </View>
        ) : results.length === 0 ? (
          <View className="py-12 items-center">
            <Ionicons name="people-outline" size={36} color="#9ca3af" />
            <Text className="text-gray-500 mt-2 text-sm text-center">
              {searched ? 'Cap usuari trobat.' : 'Escriu un nom per cercar.'}
            </Text>
          </View>
        ) : (
          <>
            <Text className="text-xs text-gray-400 mb-2 ml-1">
              {results.length} de {total} {total === 1 ? 'usuari' : 'usuaris'}
            </Text>
            {results.map((u) => (
              <UserCard key={u.user_id} user={u} />
            ))}
            {results.length < total && (
              <Pressable
                onPress={loadMore}
                disabled={loadingMore}
                className="rounded-xl bg-surface dark:bg-slate-800 border border-gray-200 dark:border-slate-700 py-3 mt-1 items-center active:opacity-80"
              >
                {loadingMore ? (
                  <ActivityIndicator color="#15803d" />
                ) : (
                  <Text className="text-sm font-semibold text-brand-700">Carregar-ne més</Text>
                )}
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function UserCard({ user }: { user: UserSearchResult }) {
  const { t } = useTranslation();
  const isTechnical = user.role === 'TECHNICAL';
  return (
    <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 mb-3">
      <View className="flex-row items-center">
        <View className="mr-3">
          <Avatar name={user.name} surname={user.surname} uri={user.avatarUrl} size={52} />
        </View>
        <View style={{ flex: 1 }}>
          <Text className="text-base font-bold text-gray-900 dark:text-slate-100">
            {user.name} {user.surname}
          </Text>
          <Text className="text-xs text-gray-500">@{user.nickname}</Text>
          <View className="mt-1 self-start flex-row items-center rounded-full px-2 py-0.5"
            style={{ backgroundColor: isTechnical ? '#dbeafe' : '#dcfce7' }}>
            <Text className="text-xs font-semibold" style={{ color: isTechnical ? '#1e40af' : '#15803d' }}>
              {isTechnical ? 'Tècnic' : 'Estudiant'}
            </Text>
          </View>
        </View>
        {!isTechnical && (
          <View className="items-end">
            <Text className="text-lg font-bold text-brand-700">{user.points}</Text>
            <Text className="text-xs text-gray-400">punts</Text>
          </View>
        )}
      </View>

      <View className="h-px bg-gray-100 dark:bg-slate-700 my-3" />

      <InfoRow icon="mail-outline" value={user.email} />
      {isTechnical && (
        <>
          {!!user.position && <InfoRow icon="briefcase-outline" value={user.position} />}
          {!!user.company && <InfoRow icon="business-outline" value={user.company} />}
          {!!user.workCategory && (
            <InfoRow icon="construct-outline" value={t(`categories.${user.workCategory}`)} />
          )}
        </>
      )}
      <InfoRow
        icon="checkmark-done-outline"
        value={
          isTechnical
            ? `${user.solvedCount} incidències solucionades`
            : `${user.solvedCount} incidències resoltes`
        }
      />
    </View>
  );
}

function InfoRow({ icon, value }: { icon: React.ComponentProps<typeof Ionicons>['name']; value: string }) {
  return (
    <View className="flex-row items-center py-1">
      <Ionicons name={icon} size={15} color="#6b7280" style={{ marginRight: 8 }} />
      <Text className="text-sm text-gray-700 dark:text-slate-300 flex-1">{value}</Text>
    </View>
  );
}

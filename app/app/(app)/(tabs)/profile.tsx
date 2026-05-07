import { View, Text, Pressable, ScrollView, SafeAreaView, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../src/context/AuthContext';
import { useReports } from '../../../src/hooks/useReports';
import { getReportsByRole, CATEGORY_LABELS } from '../../../src/mocks/reports';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ROLE_INFO: Record<string, { label: string; icon: IoniconName }> = {
  STUDENT: { label: 'Estudiant UAB', icon: 'school-outline' },
  TECHNICAL: { label: 'Personal tècnic', icon: 'construct-outline' },
  ADMIN: { label: 'Administrador', icon: 'shield-checkmark-outline' },
};

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { reports } = useReports();
  if (!user) return null;

  const info = ROLE_INFO[user.role];
  const myReports = getReportsByRole(reports, user.role, user.nickname);
  const resolved = myReports.filter((r) => r.state === 'VALIDATED' || r.state === 'CLOSED').length;

  const confirmLogout = () => {
    Alert.alert(
      'Tancar sessió',
      'Segur que vols sortir?',
      [
        { text: 'Cancel·lar', style: 'cancel' },
        { text: 'Sortir', style: 'destructive', onPress: () => logout() },
      ],
    );
  };

  const initials = `${user.name[0] ?? ''}${user.surname[0] ?? ''}`.toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        {/* Avatar + nom */}
        <View className="items-center mb-6 mt-4">
          <View className="w-24 h-24 rounded-full bg-brand-600 items-center justify-center mb-3">
            <Text className="text-white text-3xl font-bold">{initials}</Text>
          </View>
          <Text className="text-xl font-bold text-gray-900">
            {user.name} {user.surname}
          </Text>
          <Text className="text-sm text-gray-500">@{user.nickname}</Text>
          <View className="mt-2 flex-row items-center bg-brand-100 rounded-full px-3 py-1">
            <Ionicons name={info.icon} size={14} color="#1d4ed8" />
            <Text className="text-xs font-semibold text-brand-700 ml-1.5">{info.label}</Text>
          </View>
        </View>

        {/* Stats */}
        <View className="rounded-2xl bg-white border border-gray-100 p-5 mb-5">
          {user.role === 'STUDENT' && (
            <>
              <StatLine icon="trophy-outline" label="Punts" value={String(user.points)} color="#1d4ed8" />
              <Divider />
              <StatLine icon="document-text-outline" label="Incidències reportades" value={String(myReports.length)} />
              <Divider />
              <StatLine icon="checkmark-done-outline" label="Resoltes gràcies a tu" value={String(resolved)} color="#059669" />
            </>
          )}
          {user.role === 'TECHNICAL' && (
            <>
              <StatLine icon="briefcase-outline" label="Incidències assignades" value={String(myReports.length)} color="#1d4ed8" />
              <Divider />
              <StatLine icon="checkmark-done-outline" label="Resoltes" value={String(resolved)} color="#059669" />
            </>
          )}
          {user.role === 'ADMIN' && (
            <>
              <StatLine icon="shield-checkmark-outline" label="Administrador" value="Accés complet" color="#1d4ed8" />
              <Divider />
              <StatLine icon="globe-outline" label="Gestió avançada" value="Dashboard web" />
            </>
          )}
        </View>

        {/* Dades */}
        <Text className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-2">Dades del compte</Text>
        <View className="rounded-2xl bg-white border border-gray-100 mb-5">
          <DataRow label="Correu" value={user.email} />
          <Divider />
          <DataRow label="Membre des de" value={new Date(user.createdAt).toLocaleDateString('ca-ES')} />
        </View>

        {/* Dades professionals (només tècnics) */}
        {user.role === 'TECHNICAL' && (
          <>
            <Text className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-2">
              Dades professionals
            </Text>
            <View className="rounded-2xl bg-white border border-gray-100 mb-5">
              <DataRow label="Posició" value={user.position ?? '—'} />
              <Divider />
              <DataRow label="Empresa" value={user.company ?? '—'} />
              <Divider />
              <DataRow
                label="Àmbit"
                value={user.workCategory ? CATEGORY_LABELS[user.workCategory] : '—'}
              />
            </View>
          </>
        )}

        {/* Opcions */}
        <Text className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-2">Configuració</Text>
        <View className="rounded-2xl bg-white border border-gray-100 mb-6">
          <OptionRow
            icon="person-outline"
            label="Editar perfil"
            onPress={() => router.push('/settings')}
          />
          <Divider />
          <OptionRow icon="notifications-outline" label="Notificacions" />
          <Divider />
          <OptionRow icon="language-outline" label="Idioma" trailing="Català" />
          <Divider />
          <OptionRow icon="information-circle-outline" label="Sobre CityFix" />
        </View>

        {/* Logout */}
        <Pressable
          onPress={confirmLogout}
          className="rounded-xl border border-red-200 bg-red-50 py-4 active:bg-red-100 flex-row items-center justify-center"
        >
          <Ionicons name="log-out-outline" size={18} color="#dc2626" />
          <Text className="text-base font-semibold text-red-600 ml-2">Tancar sessió</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatLine({ icon, label, value, color }: { icon: IoniconName; label: string; value: string; color?: string }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <View className="flex-row items-center">
        <Ionicons name={icon} size={18} color={color ?? '#374151'} style={{ marginRight: 10 }} />
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
      <Ionicons name={icon} size={18} color="#374151" style={{ marginRight: 12 }} />
      <Text className="text-sm text-gray-800 flex-1">{label}</Text>
      {trailing && <Text className="text-sm text-gray-400 mr-2">{trailing}</Text>}
      <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
    </Pressable>
  );
}

function Divider() {
  return <View className="h-px bg-gray-100 mx-4" />;
}

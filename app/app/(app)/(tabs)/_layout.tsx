import { Tabs } from 'expo-router';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'nativewind';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/context/AuthContext';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({
  name,
  nameFocused,
  focused,
  color,
}: {
  name: IoniconName;
  nameFocused: IoniconName;
  focused: boolean;
  color: string;
}) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={focused ? nameFocused : name} size={22} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const role = user?.role ?? 'STUDENT';

  const isStudent = role === 'STUDENT';
  const isTechnical = role === 'TECHNICAL';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: isDark ? '#0f172a' : '#f9fafb' },
        tabBarActiveTintColor: '#15803d',
        tabBarInactiveTintColor: isDark ? '#94a3b8' : '#6b7280',
        tabBarShowLabel: true,
        tabBarStyle: {
          position: 'absolute',
          bottom: Platform.OS === 'ios' ? 28 : 18,
          left: 32,
          right: 32,
          height: 64,
          borderRadius: 32,
          backgroundColor: isDark ? 'rgba(30,41,59,0.98)' : 'rgba(255,255,255,0.96)',
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          paddingTop: 8,
          paddingBottom: 8,
          paddingHorizontal: 8,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 12,
        },
        tabBarItemStyle: {
          borderRadius: 20,
          marginHorizontal: 2,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginTop: -2,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="home-outline" nameFocused="home" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: t('tabs.map'),
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="map-outline" nameFocused="map" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tabs.create'),
          href: isStudent ? '/create' : null,
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              name="add-circle-outline"
              nameFocused="add-circle"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: isStudent ? t('tabs.mine') : isTechnical ? t('tabs.assigned') : t('tabs.all'),
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="list-outline" nameFocused="list" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: t('tabs.points'),
          tabBarIcon: ({ focused, color }) => (
            <TabIcon name="trophy-outline" nameFocused="trophy" focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ focused, color }) => (
            <TabIcon
              name="person-outline"
              nameFocused="person"
              focused={focused}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

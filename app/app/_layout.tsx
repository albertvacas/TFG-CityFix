import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { ThemeProvider, useAppTheme } from '../src/context/ThemeContext';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import '../src/i18n';
import '../global.css';

function RootLayoutNav() {
  const { user, loading } = useAuth();
  const { resolved } = useAppTheme();
  const segments = useSegments();
  const router = useRouter();

  // Registra el dispositiu a Expo Push Notifications quan hi ha sessió.
  // L'identificador del dispositiu queda lligat al userId al backend; en
  // logout, AuthContext s'encarrega de desactivar-lo.
  usePushNotifications(user?.user_id ?? null);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/home');
    }
  }, [user, loading, segments]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator size="large" color="#15803d" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: resolved === 'dark' ? '#0f172a' : '#f9fafb' },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RootLayoutNav />
      </AuthProvider>
    </ThemeProvider>
  );
}

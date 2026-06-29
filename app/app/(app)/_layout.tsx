import { Stack } from 'expo-router';
import { useAppTheme } from '../../src/context/ThemeContext';

export default function AppLayout() {
  const { resolved } = useAppTheme();
  const bg = resolved === 'dark' ? '#0f172a' : '#f9fafb';
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="incident/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="settings" options={{ presentation: 'card' }} />
      <Stack.Screen name="users" options={{ presentation: 'card' }} />
      <Stack.Screen name="about" options={{ presentation: 'card' }} />
    </Stack>
  );
}

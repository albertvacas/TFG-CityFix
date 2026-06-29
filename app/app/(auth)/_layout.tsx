import { Stack } from 'expo-router';
import { useAppTheme } from '../../src/context/ThemeContext';

export default function AuthLayout() {
  const { resolved } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: resolved === 'dark' ? '#0f172a' : '#f9fafb' },
      }}
    />
  );
}

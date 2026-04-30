import { useState } from 'react';
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../src/context/AuthContext';

const loginSchema = z.object({
  email: z.string().min(1, 'El correu és obligatori').email('Format de correu invàlid'),
  password: z.string().min(1, 'La contrasenya és obligatòria'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setSubmitting(true);
    try {
      await login(data.email, data.password);
    } catch (err: any) {
      Alert.alert(
        'Error d\'inici de sessió',
        err.response?.data?.error || 'No s\'ha pogut iniciar sessió. Comprova les credencials.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View className="flex-1 justify-center px-6 py-12">
          {/* Header */}
          <View className="mb-10 items-center">
            <View className="mb-4 h-20 w-20 items-center justify-center rounded-2xl bg-brand-600">
              <Text className="text-4xl font-bold text-white">C</Text>
            </View>
            <Text className="text-3xl font-bold text-gray-900">CityFix</Text>
            <Text className="mt-1 text-sm text-gray-500">Gestió d'incidències del Campus UAB</Text>
          </View>

          {/* Email */}
          <View className="mb-4">
            <Text className="mb-1.5 text-sm font-medium text-gray-700">Correu electrònic</Text>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${
                    errors.email ? 'border-red-400' : 'border-gray-300'
                  }`}
                  placeholder="niu@uab.cat"
                  placeholderTextColor="#9ca3af"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
              )}
            />
            {errors.email && <Text className="mt-1 text-xs text-red-500">{errors.email.message}</Text>}
          </View>

          {/* Password */}
          <View className="mb-6">
            <Text className="mb-1.5 text-sm font-medium text-gray-700">Contrasenya</Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${
                    errors.password ? 'border-red-400' : 'border-gray-300'
                  }`}
                  placeholder="••••••••"
                  placeholderTextColor="#9ca3af"
                  secureTextEntry
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
              )}
            />
            {errors.password && <Text className="mt-1 text-xs text-red-500">{errors.password.message}</Text>}
          </View>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit(onSubmit)}
            disabled={submitting}
            className={`rounded-xl py-4 active:bg-brand-700 ${submitting ? 'bg-brand-500/70' : 'bg-brand-600'}`}
          >
            <Text className="text-center text-base font-semibold text-white">
              {submitting ? 'Iniciant sessió...' : 'Iniciar sessió'}
            </Text>
          </Pressable>

          {/* Register link */}
          <View className="mt-6 flex-row justify-center">
            <Text className="text-sm text-gray-500">Encara no tens compte? </Text>
            <Pressable onPress={() => router.push('/(auth)/register')}>
              <Text className="text-sm font-semibold text-brand-600">Registra't</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

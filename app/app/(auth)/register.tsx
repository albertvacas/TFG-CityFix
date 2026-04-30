import { useState } from 'react';
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../../src/context/AuthContext';

const UAB_DOMAINS = ['uab.cat', 'autonoma.cat', 'e-campus.uab.cat'];

const isUabEmail = (email: string) => {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && UAB_DOMAINS.includes(domain);
};

type RegisterMode = 'student' | 'invited';

const buildSchema = (mode: RegisterMode) =>
  z.object({
    name: z.string().min(1, 'Nom obligatori'),
    surname: z.string().min(1, 'Cognoms obligatoris'),
    nickname: z.string().min(3, 'Mínim 3 caràcters'),
    // Domini UAB obligatori només en registre públic (estudiant). Per al flux
    // amb invitació no ho exigim al client: el backend decideix segons el rol
    // de la invitació (ADMIN sí, TECHNICAL no, perquè sovint són externs).
    email:
      mode === 'student'
        ? z.string().email('Correu invàlid').refine(isUabEmail, {
            message: 'Ha de ser un correu institucional UAB',
          })
        : z.string().email('Correu invàlid'),
    password: z.string().min(6, 'Mínim 6 caràcters'),
    token: mode === 'invited'
      ? z.string().min(1, 'El codi d\'invitació és obligatori')
      : z.string().optional(),
  });

type FormData = {
  name: string;
  surname: string;
  nickname: string;
  email: string;
  password: string;
  token?: string;
};

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<RegisterMode>('student');
  const [submitting, setSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(buildSchema(mode)) as any,
    defaultValues: { name: '', surname: '', nickname: '', email: '', password: '', token: '' },
  });

  const switchMode = (m: RegisterMode) => {
    setMode(m);
    reset({ name: '', surname: '', nickname: '', email: '', password: '', token: '' });
  };

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const payload: any = {
        name: data.name,
        surname: data.surname,
        nickname: data.nickname,
        email: data.email,
        password: data.password,
      };
      if (mode === 'invited') {
        payload.token = data.token;
        payload.role = 'TECHNICAL'; // El backend ignora això i usa invite.role
      }
      await register(payload);
    } catch (err: any) {
      Alert.alert(
        'Error de registre',
        err.response?.data?.error || 'No s\'ha pogut completar el registre.',
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
        <View className="flex-1 px-6 py-10">
          {/* Header */}
          <View className="mb-6">
            <Text className="text-3xl font-bold text-gray-900">Crear compte</Text>
            <Text className="mt-1 text-sm text-gray-500">Uneix-te a CityFix</Text>
          </View>

          {/* Mode selector (tabs) */}
          <View className="mb-6 flex-row rounded-xl bg-gray-100 p-1">
            <Pressable
              onPress={() => switchMode('student')}
              className="flex-1 rounded-lg py-2.5"
              style={{ backgroundColor: mode === 'student' ? '#ffffff' : 'transparent' }}
            >
              <Text className="text-center text-sm font-medium" style={{ color: mode === 'student' ? '#1d4ed8' : '#6b7280' }}>
                Estudiant UAB
              </Text>
            </Pressable>
            <Pressable
              onPress={() => switchMode('invited')}
              className="flex-1 rounded-lg py-2.5"
              style={{ backgroundColor: mode === 'invited' ? '#ffffff' : 'transparent' }}
            >
              <Text className="text-center text-sm font-medium" style={{ color: mode === 'invited' ? '#1d4ed8' : '#6b7280' }}>
                Amb codi d'invitació
              </Text>
            </Pressable>
          </View>

          {/* Name + Surname */}
          <View className="mb-4 flex-row gap-3">
            <View className="flex-1">
              <Text className="mb-1.5 text-sm font-medium text-gray-700">Nom</Text>
              <Controller
                control={control}
                name="name"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${errors.name ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder="ex: Maria"
                    placeholderTextColor="#9ca3af"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                  />
                )}
              />
              {errors.name && <Text className="mt-1 text-xs text-red-500">{errors.name.message}</Text>}
            </View>
            <View className="flex-1">
              <Text className="mb-1.5 text-sm font-medium text-gray-700">Cognoms</Text>
              <Controller
                control={control}
                name="surname"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${errors.surname ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder="ex: Pérez García"
                    placeholderTextColor="#9ca3af"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                  />
                )}
              />
              {errors.surname && <Text className="mt-1 text-xs text-red-500">{errors.surname.message}</Text>}
            </View>
          </View>

          {/* Nickname */}
          <View className="mb-4">
            <Text className="mb-1.5 text-sm font-medium text-gray-700">Nom d'usuari</Text>
            <Controller
              control={control}
              name="nickname"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${errors.nickname ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="ex: mariaperez8237"
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
              )}
            />
            {errors.nickname && <Text className="mt-1 text-xs text-red-500">{errors.nickname.message}</Text>}
          </View>

          {/* Email */}
          <View className="mb-4">
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              {mode === 'student' ? 'Correu UAB' : 'Correu electrònic'}
            </Text>
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${errors.email ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder={mode === 'student' ? 'niu@uab.cat' : 'el.teu@correu.com'}
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
          <View className="mb-4">
            <Text className="mb-1.5 text-sm font-medium text-gray-700">Contrasenya</Text>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${errors.password ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="Mínim 6 caràcters"
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

          {/* Invitation token (només mode invited) */}
          {mode === 'invited' && (
            <View className="mb-4">
              <Text className="mb-1.5 text-sm font-medium text-gray-700">Codi d'invitació</Text>
              <Controller
                control={control}
                name="token"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    className={`rounded-xl border px-4 py-3.5 text-base text-gray-900 ${errors.token ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder="Codi rebut per correu"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                  />
                )}
              />
              {errors.token && <Text className="mt-1 text-xs text-red-500">{errors.token.message}</Text>}
              <Text className="mt-2 text-xs text-gray-400">
                Demana el codi a un administrador per registrar-te com a personal tècnic.
              </Text>
            </View>
          )}

          {/* Submit */}
          <Pressable
            onPress={handleSubmit(onSubmit)}
            disabled={submitting}
            className={`mt-2 rounded-xl py-4 active:bg-brand-700 ${submitting ? 'bg-brand-500/70' : 'bg-brand-600'}`}
          >
            <Text className="text-center text-base font-semibold text-white">
              {submitting ? 'Creant compte...' : 'Crear compte'}
            </Text>
          </Pressable>

          {/* Login link */}
          <View className="mt-6 flex-row justify-center">
            <Text className="text-sm text-gray-500">Ja tens compte? </Text>
            <Pressable onPress={() => router.push('/(auth)/login')}>
              <Text className="text-sm font-semibold text-brand-600">Inicia sessió</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

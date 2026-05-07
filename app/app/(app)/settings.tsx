import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/context/AuthContext';
import { updateProfile } from '../../src/api/auth';
import type { ReportCategory } from '../../src/types';

const CATEGORY_OPTIONS: { value: ReportCategory; label: string }[] = [
  { value: 'LIGHTING', label: 'Il·luminació' },
  { value: 'URBAN_FURNITURE', label: 'Mobiliari urbà' },
  { value: 'PAVEMENT', label: 'Via pública' },
  { value: 'CLEANING', label: 'Neteja' },
  { value: 'GREEN_AREAS', label: 'Zones verdes' },
  { value: 'SIGNAGE', label: 'Senyalització' },
  { value: 'ACCESSIBILITY', label: 'Accessibilitat' },
  { value: 'TECHNOLOGY', label: 'Tecnologia' },
  { value: 'OTHER', label: 'Altres' },
];

export default function SettingsScreen() {
  const { user, setUser } = useAuth();
  const isTechnical = user?.role === 'TECHNICAL';

  const [name, setName] = useState(user?.name ?? '');
  const [surname, setSurname] = useState(user?.surname ?? '');
  const [position, setPosition] = useState(user?.position ?? '');
  const [company, setCompany] = useState(user?.company ?? '');
  const [workCategory, setWorkCategory] = useState<ReportCategory | null>(
    (user?.workCategory as ReportCategory | null) ?? null,
  );
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const onSave = async () => {
    if (!name.trim() || !surname.trim()) {
      Alert.alert('Camps obligatoris', 'El nom i els cognoms no poden estar buits.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        surname: surname.trim(),
      };
      if (isTechnical) {
        // Enviem null explícit quan el camp queda buit per tal d'esborrar el valor
        // anterior al backend; en cas contrari el camp es manté com estava.
        payload.position = position.trim() ? position.trim() : null;
        payload.company = company.trim() ? company.trim() : null;
        payload.workCategory = workCategory;
      }
      const updated = await updateProfile(payload);
      setUser(updated);
      Alert.alert('Perfil actualitzat', 'Els canvis s\'han desat correctament.');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'No s\'han pogut desar els canvis');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      {/* Topbar */}
      <View className="flex-row items-center px-4 py-3 bg-white border-b border-gray-100">
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-2 mr-2">
          <Ionicons name="arrow-back" size={22} color="#1f2937" />
        </Pressable>
        <Text className="text-lg font-bold text-gray-900 flex-1">Configuració del compte</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* Dades bàsiques */}
          <Text className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Dades personals
          </Text>
          <View className="rounded-2xl bg-white border border-gray-100 p-4 mb-5">
            <Text className="mb-1.5 text-sm font-medium text-gray-700">Nom</Text>
            <TextInput
              className="rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 mb-3"
              placeholder="Nom"
              placeholderTextColor="#9ca3af"
              value={name}
              onChangeText={setName}
            />
            <Text className="mb-1.5 text-sm font-medium text-gray-700">Cognoms</Text>
            <TextInput
              className="rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900"
              placeholder="Cognoms"
              placeholderTextColor="#9ca3af"
              value={surname}
              onChangeText={setSurname}
            />
          </View>

          {/* Camps de tècnic */}
          {isTechnical && (
            <>
              <Text className="text-xs font-semibold text-gray-500 uppercase mb-2">
                Dades del tècnic
              </Text>
              <View className="rounded-2xl bg-white border border-gray-100 p-4 mb-5">
                <Text className="mb-1.5 text-sm font-medium text-gray-700">Posició / Càrrec</Text>
                <TextInput
                  className="rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 mb-3"
                  placeholder="ex: Electricista, Jardiner…"
                  placeholderTextColor="#9ca3af"
                  value={position}
                  onChangeText={setPosition}
                />

                <Text className="mb-1.5 text-sm font-medium text-gray-700">Empresa</Text>
                <TextInput
                  className="rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 mb-4"
                  placeholder="ex: Eulen, Ferrovial…"
                  placeholderTextColor="#9ca3af"
                  value={company}
                  onChangeText={setCompany}
                />

                <Text className="mb-1.5 text-sm font-medium text-gray-700">Àmbit principal</Text>
                <View className="flex-row flex-wrap gap-2">
                  {CATEGORY_OPTIONS.map((opt) => {
                    const selected = workCategory === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => setWorkCategory(selected ? null : opt.value)}
                        className="rounded-full px-3 py-1.5"
                        style={{ backgroundColor: selected ? '#1d4ed8' : '#f3f4f6' }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{ color: selected ? '#ffffff' : '#374151' }}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="mt-2 text-xs text-gray-400">
                  L'admin et recomanarà incidències d'aquesta categoria.
                </Text>
              </View>
            </>
          )}

          {/* Save button */}
          <Pressable
            onPress={onSave}
            disabled={saving}
            className="rounded-xl py-4 active:opacity-90 flex-row items-center justify-center"
            style={{ backgroundColor: saving ? '#9ca3af' : '#1d4ed8' }}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color="#ffffff" />
                <Text className="text-white font-semibold ml-2">Desar canvis</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

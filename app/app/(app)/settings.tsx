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
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/context/AuthContext';
import { useAppTheme, type ThemePreference } from '../../src/context/ThemeContext';
import { updateProfile, uploadAvatar } from '../../src/api/auth';
import Avatar from '../../src/components/Avatar';
import { changeLanguage, LANGUAGES } from '../../src/i18n';
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

const THEME_OPTIONS: { value: ThemePreference; icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
  { value: 'light', icon: 'sunny-outline', key: 'themeLight' },
  { value: 'dark', icon: 'moon-outline', key: 'themeDark' },
  { value: 'system', icon: 'phone-portrait-outline', key: 'themeSystem' },
];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuth();
  const { preference, setPreference } = useAppTheme();
  const isTechnical = user?.role === 'TECHNICAL';

  const [name, setName] = useState(user?.name ?? '');
  const [surname, setSurname] = useState(user?.surname ?? '');
  const [position, setPosition] = useState(user?.position ?? '');
  const [company, setCompany] = useState(user?.company ?? '');
  const [workCategory, setWorkCategory] = useState<ReportCategory | null>(
    (user?.workCategory as ReportCategory | null) ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const changeAvatar = () => {
    Alert.alert('Foto de perfil', 'Tria una opció', [
      { text: 'Fer foto', onPress: () => pickAndUpload('camera') },
      { text: 'Triar de la galeria', onPress: () => pickAndUpload('library') },
      { text: 'Cancel·lar', style: 'cancel' },
    ]);
  };

  const pickAndUpload = async (source: 'camera' | 'library') => {
    try {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permís denegat', 'Cal permís per accedir a la càmera o galeria.');
        return;
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsEditing: true, aspect: [1, 1] });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploadingAvatar(true);
      const updated = await uploadAvatar(result.assets[0].uri);
      setUser(updated);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'No s\'ha pogut actualitzar la foto.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (!user) return null;

  const onSave = async () => {
    if (!name.trim() || !surname.trim()) {
      Alert.alert(t('settings.requiredTitle'), t('settings.requiredBody'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        surname: surname.trim(),
      };
      if (isTechnical) {
        // Enviem null explícit quan el camp queda buit per esborrar el valor
        // anterior al backend; en cas contrari el camp es manté com estava.
        payload.position = position.trim() ? position.trim() : null;
        payload.company = company.trim() ? company.trim() : null;
        payload.workCategory = workCategory;
      }
      const updated = await updateProfile(payload);
      setUser(updated);
      Alert.alert(t('settings.savedTitle'), t('settings.savedBody'));
      router.back();
    } catch (e: any) {
      Alert.alert(
        t('settings.errorTitle'),
        e?.response?.data?.error ?? e?.message ?? t('settings.errorBody'),
      );
    } finally {
      setSaving(false);
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
          {t('settings.title')}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {/* Foto de perfil */}
          <View className="items-center mb-6">
            <Pressable onPress={changeAvatar} disabled={uploadingAvatar} className="active:opacity-80">
              <Avatar name={user.name} surname={user.surname} uri={user.avatarUrl} size={96} />
              <View className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-brand-600 items-center justify-center border-2 border-white">
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Ionicons name="camera" size={16} color="#ffffff" />
                )}
              </View>
            </Pressable>
          </View>

          {/* Dades bàsiques */}
          <Text className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-2">
            {t('settings.personalData')}
          </Text>
          <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 mb-5">
            <Text className="mb-1.5 text-sm font-medium text-gray-700 dark:text-slate-300">
              {t('settings.name')}
            </Text>
            <TextInput
              className="rounded-xl border border-gray-300 dark:border-slate-600 px-4 py-3 text-base text-gray-900 dark:text-slate-100 mb-3"
              placeholder={t('settings.name')}
              placeholderTextColor="#9ca3af"
              value={name}
              onChangeText={setName}
            />
            <Text className="mb-1.5 text-sm font-medium text-gray-700 dark:text-slate-300">
              {t('settings.surname')}
            </Text>
            <TextInput
              className="rounded-xl border border-gray-300 dark:border-slate-600 px-4 py-3 text-base text-gray-900 dark:text-slate-100"
              placeholder={t('settings.surname')}
              placeholderTextColor="#9ca3af"
              value={surname}
              onChangeText={setSurname}
            />
          </View>

          {/* Camps de tècnic */}
          {isTechnical && (
            <>
              <Text className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-2">
                {t('settings.technicianData')}
              </Text>
              <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 mb-5">
                <Text className="mb-1.5 text-sm font-medium text-gray-700 dark:text-slate-300">
                  {t('settings.position')}
                </Text>
                <TextInput
                  className="rounded-xl border border-gray-300 dark:border-slate-600 px-4 py-3 text-base text-gray-900 dark:text-slate-100 mb-3"
                  placeholder="ex: Electricista, Jardiner…"
                  placeholderTextColor="#9ca3af"
                  value={position}
                  onChangeText={setPosition}
                />

                <Text className="mb-1.5 text-sm font-medium text-gray-700 dark:text-slate-300">
                  {t('settings.company')}
                </Text>
                <TextInput
                  className="rounded-xl border border-gray-300 dark:border-slate-600 px-4 py-3 text-base text-gray-900 dark:text-slate-100 mb-4"
                  placeholder="ex: Eulen, Ferrovial…"
                  placeholderTextColor="#9ca3af"
                  value={company}
                  onChangeText={setCompany}
                />

                <Text className="mb-1.5 text-sm font-medium text-gray-700 dark:text-slate-300">
                  {t('settings.mainScope')}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {CATEGORY_OPTIONS.map((opt) => {
                    const selected = workCategory === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => setWorkCategory(selected ? null : opt.value)}
                        className="rounded-full px-3 py-1.5"
                        style={{ backgroundColor: selected ? '#15803d' : '#f3f4f6' }}
                      >
                        <Text
                          className="text-xs font-medium"
                          style={{ color: selected ? '#ffffff' : '#6b7280' }}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text className="mt-2 text-xs text-gray-400 dark:text-slate-500">
                  {t('settings.scopeHint')}
                </Text>
              </View>
            </>
          )}

          {/* Aparença */}
          <Text className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-2">
            {t('settings.appearance')}
          </Text>
          <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 mb-5">
            <Text className="mb-2 text-sm font-medium text-gray-700 dark:text-slate-300">
              {t('settings.theme')}
            </Text>
            <View className="flex-row gap-2">
              {THEME_OPTIONS.map((opt) => {
                const selected = preference === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setPreference(opt.value)}
                    className="flex-1 items-center rounded-xl py-3 border"
                    style={{
                      backgroundColor: selected ? '#15803d' : 'transparent',
                      borderColor: selected ? '#15803d' : '#d1d5db',
                    }}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={20}
                      color={selected ? '#ffffff' : '#6b7280'}
                    />
                    <Text
                      className="text-xs font-medium mt-1"
                      style={{ color: selected ? '#ffffff' : '#6b7280' }}
                    >
                      {t(`settings.${opt.key}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Idioma */}
          <Text className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-2">
            {t('settings.language')}
          </Text>
          <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 mb-5">
            <View className="flex-row flex-wrap gap-2">
              {LANGUAGES.map((lang) => {
                const selected = i18n.language.startsWith(lang.code);
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => changeLanguage(lang.code)}
                    className="rounded-full px-4 py-2 border"
                    style={{
                      backgroundColor: selected ? '#15803d' : 'transparent',
                      borderColor: selected ? '#15803d' : '#d1d5db',
                    }}
                  >
                    <Text
                      className="text-sm font-medium"
                      style={{ color: selected ? '#ffffff' : '#6b7280' }}
                    >
                      {lang.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Save button */}
          <Pressable
            onPress={onSave}
            disabled={saving}
            className="rounded-xl py-4 active:opacity-90 flex-row items-center justify-center"
            style={{ backgroundColor: saving ? '#9ca3af' : '#15803d' }}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color="#ffffff" />
                <Text className="text-white font-semibold ml-2">{t('settings.save')}</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

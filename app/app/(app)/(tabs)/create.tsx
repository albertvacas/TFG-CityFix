import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useColorScheme } from 'nativewind';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { CATEGORY_IONICONS } from '../../../src/mocks/reports';
import { createReport, uploadReportImage } from '../../../src/api/reports';
import { LocationPicker } from '../../../src/components/LocationPicker';
import type { ReportCategory } from '../../../src/types';

const CATEGORIES: ReportCategory[] = [
  'LIGHTING',
  'URBAN_FURNITURE',
  'PAVEMENT',
  'CLEANING',
  'GREEN_AREAS',
  'SIGNAGE',
  'ACCESSIBILITY',
  'TECHNOLOGY',
  'OTHER',
];

const UAB_CENTER = { latitude: 41.5025, longitude: 2.1060 };

interface Coords {
  latitude: number;
  longitude: number;
}

export default function CreateScreen() {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const isDark = colorScheme === 'dark';
  // Colors per a botons amb fons inline (no s'inverteixen amb classes).
  const inactiveBg = isDark ? '#1e293b' : '#ffffff';
  const inactiveText = isDark ? '#cbd5e1' : '#6b7280';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');
  const [locMode, setLocMode] = useState<'gps' | 'map'>('gps');
  const [pickedCoords, setPickedCoords] = useState<Coords | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset del formulari quan l'usuari deixa el tab. Així, en tornar a entrar,
  // el formulari està net i no arrossega text/foto/coords del darrer intent.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setTitle('');
        setDescription('');
        setCategory(null);
        setPhotoUri(null);
        setLocMode('gps');
        setPickedCoords(null);
        setSubmitting(false);
        // No netegem `coords` ni `locStatus` perquè la posició GPS s'obté de
        // nou al següent muntatge (i mantenir-la evita un flicker innecessari).
      };
    }, []),
  );

  // Demanar permís i obtenir ubicació al muntar
  useEffect(() => {
    (async () => {
      setLocStatus('loading');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocStatus('denied');
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocStatus('granted');
      } catch {
        setLocStatus('denied');
      }
    })();
  }, []);

  // Coords efectives segons el mode escollit per l'usuari
  const effectiveCoords: Coords =
    locMode === 'map' ? pickedCoords ?? UAB_CENTER : coords ?? UAB_CENTER;

  // Si el mode és 'map' i encara no ha picat el mapa, no pot enviar (l'usuari
  // ha de confirmar la ubicació explícitament). Si és 'gps' i no hi ha coords,
  // es fa servir el centre del campus com a fallback (el botó queda actiu).
  const locationReady = locMode === 'gps' || pickedCoords !== null;
  const canSubmit =
    title.length > 2 &&
    description.length > 5 &&
    category !== null &&
    locationReady &&
    !submitting;

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('create.permissionDenied'), t('create.cameraPermissionBody'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  };

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('create.permissionDenied'), t('create.galleryPermissionBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !category) {
      Alert.alert(t('create.incompleteTitle'), t('create.incompleteBody'));
      return;
    }
    setSubmitting(true);
    try {
      const report = await createReport({
        title,
        description,
        category,
        latitude: effectiveCoords.latitude,
        longitude: effectiveCoords.longitude,
      });

      if (photoUri) {
        try {
          await uploadReportImage(report.report_id, photoUri, 'INITIAL');
        } catch (uploadErr: any) {
          // No bloquegem la creació si la pujada falla; informem.
          Alert.alert(
            t('create.createdNoPhotoTitle'),
            t('create.createdNoPhotoBody') +
              (uploadErr?.response?.data?.error ?? uploadErr?.message ?? t('create.unknownError')),
          );
          router.replace('/reports');
          return;
        }
      }

      Alert.alert(t('create.createdTitle'), t('create.createdBody'), [
        { text: t('create.ok'), onPress: () => router.replace('/reports') },
      ]);
    } catch (e: any) {
      Alert.alert(t('create.errorTitle'), e?.response?.data?.error ?? e?.message ?? t('create.createError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
      className="bg-gray-50"
    >
      <SafeAreaView style={{ flex: 1 }}>
        <View className="px-5 pt-4 pb-3 border-b border-gray-100 flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">{t('create.title')}</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
          {/* Foto */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">{t('create.photo')}</Text>
          <View className="flex-row gap-3 mb-3">
            <Pressable
              onPress={pickFromCamera}
              className="flex-1 rounded-2xl bg-surface border border-gray-200 py-6 items-center active:bg-gray-50"
            >
              <Ionicons name="camera-outline" size={28} color="#15803d" />
              <Text className="text-sm font-medium text-gray-700 mt-1">{t('create.camera')}</Text>
            </Pressable>
            <Pressable
              onPress={pickFromLibrary}
              className="flex-1 rounded-2xl bg-surface border border-gray-200 py-6 items-center active:bg-gray-50"
            >
              <Ionicons name="image-outline" size={28} color="#15803d" />
              <Text className="text-sm font-medium text-gray-700 mt-1">{t('create.gallery')}</Text>
            </Pressable>
          </View>

          {photoUri && (
            <View className="rounded-2xl overflow-hidden mb-5 bg-gray-200">
              <Image source={{ uri: photoUri }} style={{ width: '100%', height: 200 }} resizeMode="cover" />
              <Pressable
                onPress={() => setPhotoUri(null)}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  borderRadius: 16,
                  width: 28,
                  height: 28,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="close" size={16} color="#ffffff" />
              </Pressable>
            </View>
          )}

          {/* Títol */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">{t('create.titleLabel')}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t('create.titlePlaceholder')}
            placeholderTextColor="#9ca3af"
            className="rounded-xl border border-gray-300 bg-surface px-4 py-3.5 text-base text-gray-900 mb-4"
          />

          {/* Categoria */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">{t('create.categoryLabel')}</Text>
          <View className="flex-row flex-wrap gap-2 mb-5">
            {CATEGORIES.map((c) => {
              const active = category === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  className="rounded-full px-3 py-2 border flex-row items-center"
                  style={{
                    backgroundColor: active
                      ? isDark ? 'rgba(21,128,61,0.25)' : '#dbeafe'
                      : inactiveBg,
                    borderColor: active ? '#15803d' : isDark ? '#334155' : '#e5e7eb',
                  }}
                >
                  <Ionicons
                    name={CATEGORY_IONICONS[c]}
                    size={14}
                    color={active ? (isDark ? '#4ade80' : '#15803d') : inactiveText}
                    style={{ marginRight: 6 }}
                  />
                  <Text className="text-sm" style={{ color: active ? (isDark ? '#4ade80' : '#15803d') : inactiveText }}>
                    {t(`categories.${c}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Descripció */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">{t('create.descriptionLabel')}</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t('create.descriptionPlaceholder')}
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className="rounded-xl border border-gray-300 bg-surface px-4 py-3 text-base text-gray-900 mb-5"
            style={{ minHeight: 100 }}
          />

          {/* Ubicació */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">{t('create.location')}</Text>

          {/* Toggle de mode GPS / Mapa */}
          <View className="flex-row mb-3 self-start rounded-lg overflow-hidden border border-gray-200">
            <Pressable
              onPress={() => setLocMode('gps')}
              style={{
                backgroundColor: locMode === 'gps' ? '#15803d' : inactiveBg,
                paddingHorizontal: 14,
                paddingVertical: 8,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Ionicons
                name="locate-outline"
                size={14}
                color={locMode === 'gps' ? '#ffffff' : inactiveText}
              />
              <Text
                style={{
                  color: locMode === 'gps' ? '#ffffff' : inactiveText,
                  fontSize: 12,
                  fontWeight: '600',
                  marginLeft: 6,
                }}
              >
                {t('create.currentLocation')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setLocMode('map')}
              style={{
                backgroundColor: locMode === 'map' ? '#15803d' : inactiveBg,
                paddingHorizontal: 14,
                paddingVertical: 8,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Ionicons
                name="map-outline"
                size={14}
                color={locMode === 'map' ? '#ffffff' : inactiveText}
              />
              <Text
                style={{
                  color: locMode === 'map' ? '#ffffff' : inactiveText,
                  fontSize: 12,
                  fontWeight: '600',
                  marginLeft: 6,
                }}
              >
                {t('create.pickOnMap')}
              </Text>
            </Pressable>
          </View>

          {locMode === 'gps' ? (
            <View className="rounded-2xl bg-surface border border-gray-100 p-4 mb-5">
              <View className="flex-row items-center">
                <Ionicons
                  name={locStatus === 'granted' ? 'location' : 'location-outline'}
                  size={18}
                  color={locStatus === 'granted' ? '#15803d' : '#9ca3af'}
                />
                <View className="ml-2 flex-1">
                  {locStatus === 'loading' && (
                    <Text className="text-sm text-gray-500">{t('create.gettingLocation')}</Text>
                  )}
                  {locStatus === 'granted' && coords && (
                    <>
                      <Text className="text-sm text-gray-800 font-medium">{t('create.currentLocation')}</Text>
                      <Text className="text-xs text-gray-500">
                        {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                      </Text>
                    </>
                  )}
                  {locStatus === 'denied' && (
                    <>
                      <Text className="text-sm text-gray-800 font-medium">{t('create.noLocationPermission')}</Text>
                      <Text className="text-xs text-gray-500">
                        {t('create.noLocationHint')}
                      </Text>
                    </>
                  )}
                </View>
                {locStatus === 'loading' && <ActivityIndicator color="#15803d" />}
              </View>
            </View>
          ) : (
            <View className="mb-5">
              <LocationPicker
                initialCoords={pickedCoords ?? coords ?? UAB_CENTER}
                onChange={setPickedCoords}
              />
              <View className="flex-row items-center mt-2 px-1">
                <Ionicons
                  name={pickedCoords ? 'location' : 'location-outline'}
                  size={14}
                  color={pickedCoords ? '#15803d' : '#9ca3af'}
                />
                {pickedCoords ? (
                  <Text className="text-xs text-gray-700 ml-1">
                    {t('create.selectedLocation')}{' '}
                    <Text className="font-semibold text-gray-900">
                      {pickedCoords.latitude.toFixed(5)}, {pickedCoords.longitude.toFixed(5)}
                    </Text>
                  </Text>
                ) : (
                  <Text className="text-xs text-gray-500 ml-1 italic">
                    {t('create.tapMapHint')}
                  </Text>
                )}
              </View>
            </View>
          )}

          <Text className="text-xs text-gray-500 mb-5">
            {t('create.priorityNote')}
          </Text>

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            className="rounded-xl py-4 active:opacity-90 flex-row items-center justify-center"
            style={{ backgroundColor: canSubmit ? '#15803d' : '#9ca3af' }}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="paper-plane-outline" size={18} color="#ffffff" />
                <Text className="text-center text-base font-semibold text-white ml-2">
                  {t('create.submit')}
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
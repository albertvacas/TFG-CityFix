import { useEffect, useState } from 'react';
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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { CATEGORY_IONICONS, CATEGORY_LABELS } from '../../../src/mocks/reports';
import { createReport, uploadReportImage } from '../../../src/api/reports';
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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'loading' | 'granted' | 'denied'>('idle');
  const [submitting, setSubmitting] = useState(false);

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

  const canSubmit = title.length > 2 && description.length > 5 && category !== null && !submitting;

  const effectiveCoords: Coords = coords ?? UAB_CENTER;

  const pickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permís denegat', 'No s\'ha donat permís per accedir a la càmera.');
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
      Alert.alert('Permís denegat', 'No s\'ha donat permís per accedir a la galeria.');
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
      Alert.alert('Formulari incomplet', 'Omple els camps obligatoris (títol, descripció i categoria).');
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
            'Incidència creada sense foto',
            'La incidència s\'ha creat però no s\'ha pogut pujar la foto: ' +
              (uploadErr?.response?.data?.error ?? uploadErr?.message ?? 'error desconegut'),
          );
          router.replace('/reports');
          return;
        }
      }

      Alert.alert('Incidència creada', 'La teva incidència s\'ha enviat correctament.', [
        { text: 'OK', onPress: () => router.replace('/reports') },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'No s\'ha pogut crear');
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
        <View className="px-5 pt-4 pb-3 bg-white border-b border-gray-100 flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">Nova incidència</Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
          {/* Foto */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">Foto</Text>
          <View className="flex-row gap-3 mb-3">
            <Pressable
              onPress={pickFromCamera}
              className="flex-1 rounded-2xl bg-white border border-gray-200 py-6 items-center active:bg-gray-50"
            >
              <Ionicons name="camera-outline" size={28} color="#1d4ed8" />
              <Text className="text-sm font-medium text-gray-700 mt-1">Càmera</Text>
            </Pressable>
            <Pressable
              onPress={pickFromLibrary}
              className="flex-1 rounded-2xl bg-white border border-gray-200 py-6 items-center active:bg-gray-50"
            >
              <Ionicons name="image-outline" size={28} color="#1d4ed8" />
              <Text className="text-sm font-medium text-gray-700 mt-1">Galeria</Text>
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
          <Text className="text-sm font-semibold text-gray-700 mb-2">Títol *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Ex: Fanal trencat a la plaça"
            placeholderTextColor="#9ca3af"
            className="rounded-xl border border-gray-300 bg-white px-4 py-3.5 text-base text-gray-900 mb-4"
          />

          {/* Categoria */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">Categoria *</Text>
          <View className="flex-row flex-wrap gap-2 mb-5">
            {CATEGORIES.map((c) => {
              const active = category === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  className="rounded-full px-3 py-2 border flex-row items-center"
                  style={{
                    backgroundColor: active ? '#dbeafe' : '#ffffff',
                    borderColor: active ? '#1d4ed8' : '#e5e7eb',
                  }}
                >
                  <Ionicons
                    name={CATEGORY_IONICONS[c]}
                    size={14}
                    color={active ? '#1d4ed8' : '#6b7280'}
                    style={{ marginRight: 6 }}
                  />
                  <Text className="text-sm" style={{ color: active ? '#1d4ed8' : '#374151' }}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Descripció */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">Descripció *</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Explica amb detall què passa..."
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 mb-5"
            style={{ minHeight: 100 }}
          />

          {/* Ubicació */}
          <Text className="text-sm font-semibold text-gray-700 mb-2">Ubicació</Text>
          <View className="rounded-2xl bg-white border border-gray-100 p-4 mb-5">
            <View className="flex-row items-center">
              <Ionicons
                name={locStatus === 'granted' ? 'location' : 'location-outline'}
                size={18}
                color={locStatus === 'granted' ? '#1d4ed8' : '#9ca3af'}
              />
              <View className="ml-2 flex-1">
                {locStatus === 'loading' && (
                  <Text className="text-sm text-gray-500">Obtenint la teva ubicació…</Text>
                )}
                {locStatus === 'granted' && coords && (
                  <>
                    <Text className="text-sm text-gray-800 font-medium">Ubicació actual</Text>
                    <Text className="text-xs text-gray-500">
                      {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                    </Text>
                  </>
                )}
                {locStatus === 'denied' && (
                  <>
                    <Text className="text-sm text-gray-800 font-medium">Sense permís de ubicació</Text>
                    <Text className="text-xs text-gray-500">
                      S'utilitzarà el centre del campus ({UAB_CENTER.latitude.toFixed(4)}, {UAB_CENTER.longitude.toFixed(4)}).
                    </Text>
                  </>
                )}
              </View>
              {locStatus === 'loading' && <ActivityIndicator color="#1d4ed8" />}
            </View>
          </View>

          <Text className="text-xs text-gray-500 mb-5">
            La prioritat la determinarà l'administrador quan revisi la incidència.
          </Text>

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            className="rounded-xl py-4 active:opacity-90 flex-row items-center justify-center"
            style={{ backgroundColor: canSubmit ? '#1d4ed8' : '#9ca3af' }}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Ionicons name="paper-plane-outline" size={18} color="#ffffff" />
                <Text className="text-center text-base font-semibold text-white ml-2">
                  Enviar incidència
                </Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  SafeAreaView,
  Pressable,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../../src/context/AuthContext';
import { useReport } from '../../../src/hooks/useReports';
import { addComment, transitionReport, uploadReportImage } from '../../../src/api/reports';
import { IncidentMiniMap } from '../../../src/components/IncidentMiniMap';
import {
  CATEGORY_IONICONS,
  CATEGORY_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATE_COLORS,
  STATE_LABELS,
  formatRelativeTime,
} from '../../../src/mocks/reports';
import type { IncidentEvent, ReportComment } from '../../../src/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TRANSITION_META: Record<IncidentEvent, { label: string; icon: IoniconName; color: string }> = {
  ASSIGN: { label: 'Assignada', icon: 'person-add-outline', color: '#eab308' },
  START: { label: 'Iniciada', icon: 'play-outline', color: '#3b82f6' },
  REASSIGN: { label: 'Reassignada', icon: 'swap-horizontal-outline', color: '#a855f7' },
  RESOLVE: { label: 'Resolta', icon: 'checkmark-done-outline', color: '#059669' },
  CLOSE: { label: 'Tancada', icon: 'lock-closed-outline', color: '#374151' },
  REJECT: { label: 'Rebutjada', icon: 'close-circle-outline', color: '#dc2626' },
};

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { report, loading, error, refresh, setReport } = useReport(id);
  const [imageIdx, setImageIdx] = useState(0);
  const [acting, setActing] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveComment, setResolveComment] = useState('');
  const [resolvePhotoUri, setResolvePhotoUri] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [uploadingProgress, setUploadingProgress] = useState(false);

  const { activityComments, discussionComments } = useMemo(() => {
    const all = report?.comments ?? [];
    return {
      activityComments: all
        .filter((c) => c.transitionEvent)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      discussionComments: all
        .filter((c) => !c.transitionEvent)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    };
  }, [report]);

  if (loading && !report) {
    return (
      <SafeAreaView style={{ flex: 1 }} className="bg-gray-50 items-center justify-center">
        <ActivityIndicator color="#1d4ed8" />
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={{ flex: 1 }} className="bg-gray-50 items-center justify-center">
        <Ionicons name="alert-circle-outline" size={32} color="#9ca3af" />
        <Text className="text-gray-500 mt-2">{error ?? 'Incidència no trobada'}</Text>
        <Pressable onPress={() => router.back()} className="mt-4 flex-row items-center">
          <Ionicons name="arrow-back" size={16} color="#1d4ed8" />
          <Text className="text-brand-600 font-semibold ml-1">Tornar</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const stateColor = STATE_COLORS[report.state];
  const isAssignedToMe = !!user && report.assignedTo?.nickname === user.nickname;
  const isTechnical = user?.role === 'TECHNICAL';
  const isCreator = !!user && report.createdBy.nickname === user.nickname;
  const isAdmin = user?.role === 'ADMIN';
  const canComment = isCreator || isAssignedToMe || isAdmin;
  const images = report.images ?? [];

  const dispatchEvent = async (event: IncidentEvent, comment?: string) => {
    if (!report) return;
    setActing(true);
    try {
      const updated = await transitionReport(report.report_id, { event, comment });
      setReport(updated);
      await refresh();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'No s\'ha pogut actualitzar');
    } finally {
      setActing(false);
    }
  };

  const submitComment = async () => {
    const trimmed = commentDraft.trim();
    if (!trimmed || !report) return;
    setSendingComment(true);
    try {
      await addComment(report.report_id, trimmed);
      setCommentDraft('');
      await refresh();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'No s\'ha pogut enviar el comentari');
    } finally {
      setSendingComment(false);
    }
  };

  const uploadProgressPhoto = async (mode: 'camera' | 'library') => {
    if (!report) return;
    const perm =
      mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permís denegat', 'Cal donar permís per continuar.');
      return;
    }
    const result =
      mode === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    setUploadingProgress(true);
    try {
      await uploadReportImage(report.report_id, result.assets[0].uri, 'PROGRESS');
      await refresh();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'No s\'ha pogut pujar la foto');
    } finally {
      setUploadingProgress(false);
    }
  };

  const offerProgressPhoto = () => {
    Alert.alert(
      'Afegir foto de progrés',
      'Documenta l\'estat actual de la incidència',
      [
        { text: 'Càmera', onPress: () => uploadProgressPhoto('camera') },
        { text: 'Galeria', onPress: () => uploadProgressPhoto('library') },
        { text: 'Cancel·lar', style: 'cancel' },
      ],
    );
  };

  const pickResolvePhoto = async (mode: 'camera' | 'library') => {
    const perm =
      mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permís denegat', 'Cal donar permís per continuar.');
      return;
    }
    const result =
      mode === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) setResolvePhotoUri(result.assets[0].uri);
  };

  const submitResolve = async () => {
    if (!resolvePhotoUri) {
      Alert.alert('Foto requerida', 'Per marcar com a resolta cal adjuntar una foto del resultat.');
      return;
    }
    setActing(true);
    try {
      // 1. Pujar la foto de resolució (la incidència encara està en IN_PROGRESS, l'assignat hi té permís)
      await uploadReportImage(report.report_id, resolvePhotoUri, 'RESOLUTION');
      // 2. Transicionar amb el comentari opcional, i refrescar
      const updated = await transitionReport(report.report_id, {
        event: 'RESOLVE',
        comment: resolveComment.trim() || undefined,
      });
      setReport(updated);
      await refresh();
      setResolveOpen(false);
      setResolveComment('');
      setResolvePhotoUri(null);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'No s\'ha pogut resoldre');
    } finally {
      setActing(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      {/* Topbar */}
      <View className="flex-row items-center px-4 py-3 bg-white border-b border-gray-100">
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-2 mr-2">
          <Ionicons name="arrow-back" size={22} color="#1f2937" />
        </Pressable>
        <Text className="text-lg font-bold text-gray-900 flex-1" numberOfLines={1}>
          Detall
        </Text>
        <Pressable onPress={refresh} hitSlop={10} className="p-2">
          <Ionicons name="refresh-outline" size={20} color="#1f2937" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Imatges */}
        {images.length > 0 && (
          <View>
            <Image
              source={{ uri: images[imageIdx].url }}
              style={{ width: '100%', height: 240, backgroundColor: '#e5e7eb' }}
              resizeMode="cover"
            />
            {images.length > 1 && (
              <View className="flex-row items-center justify-center py-2 bg-white">
                {images.map((_, i) => (
                  <Pressable key={i} onPress={() => setImageIdx(i)} className="mx-1">
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: i === imageIdx ? '#1d4ed8' : '#d1d5db',
                      }}
                    />
                  </Pressable>
                ))}
              </View>
            )}
            {/* Etiqueta de tipus de la imatge actual */}
            <View
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                backgroundColor: 'rgba(0,0,0,0.6)',
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                {images[imageIdx].type === 'INITIAL'
                  ? 'INICIAL'
                  : images[imageIdx].type === 'RESOLUTION'
                  ? 'RESOLUCIÓ'
                  : 'PROGRÉS'}
              </Text>
            </View>
          </View>
        )}

        <View className="px-5 pt-4">
          {/* Títol i badges */}
          <Text className="text-xl font-bold text-gray-900 mb-2">{report.title}</Text>
          <View className="flex-row items-center flex-wrap gap-2 mb-3">
            {report.category && (
              <View className="flex-row items-center rounded-full bg-gray-100 px-3 py-1">
                <Ionicons
                  name={CATEGORY_IONICONS[report.category]}
                  size={12}
                  color="#374151"
                  style={{ marginRight: 4 }}
                />
                <Text className="text-xs font-medium text-gray-700">
                  {CATEGORY_LABELS[report.category]}
                </Text>
              </View>
            )}
            <View
              className="flex-row items-center rounded-full px-3 py-1"
              style={{ backgroundColor: PRIORITY_COLORS[report.priority] + '22' }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: PRIORITY_COLORS[report.priority],
                  marginRight: 6,
                }}
              />
              <Text className="text-xs font-semibold" style={{ color: PRIORITY_COLORS[report.priority] }}>
                {PRIORITY_LABELS[report.priority]}
              </Text>
            </View>
            <View className="rounded-full px-3 py-1" style={{ backgroundColor: stateColor.bg }}>
              <Text className="text-xs font-bold" style={{ color: stateColor.text }}>
                {STATE_LABELS[report.state].toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Descripció */}
          <Text className="text-sm font-semibold text-gray-700 mt-2 mb-1">Descripció</Text>
          <Text className="text-sm text-gray-700 leading-5 mb-4">{report.description}</Text>

          {/* Ubicació */}
          <Text className="text-sm font-semibold text-gray-700 mt-2 mb-2">Ubicació</Text>
          <IncidentMiniMap
            latitude={report.latitude}
            longitude={report.longitude}
            state={report.state}
          />
          <View className="flex-row items-center mt-2 mb-1">
            <Ionicons name="location-outline" size={14} color="#6b7280" />
            <Text className="text-xs text-gray-500 ml-1">
              {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
            </Text>
          </View>

          {/* Meta */}
          <View className="rounded-2xl bg-white border border-gray-100 p-4 mb-4 mt-3">
            <MetaRow label="Reportat per" value={`@${report.createdBy.nickname}`} />
            {/* Email visible només a admin o al tècnic assignat — útil per a aclariments */}
            {report.createdBy.email && (user?.role === 'ADMIN' || isAssignedToMe) && (
              <Pressable onPress={() => Linking.openURL(`mailto:${report.createdBy.email}`)}>
                <View className="flex-row justify-between py-1.5 items-center">
                  <Text className="text-sm text-gray-500">Contacte</Text>
                  <View className="flex-row items-center">
                    <Ionicons name="mail-outline" size={14} color="#1d4ed8" style={{ marginRight: 4 }} />
                    <Text className="text-sm text-brand-600 font-medium">{report.createdBy.email}</Text>
                  </View>
                </View>
              </Pressable>
            )}
            <MetaRow label="Data" value={formatRelativeTime(report.createdAt)} />
            <MetaRow
              label="Assignat a"
              value={report.assignedTo ? `@${report.assignedTo.nickname}` : 'Sense assignar'}
            />
            {report.resolvedAt && (
              <MetaRow label="Resolta" value={formatRelativeTime(report.resolvedAt)} />
            )}
          </View>

          {/* Activitat (timeline de transicions amb comentari) */}
          {activityComments.length > 0 && (
            <>
              <Text className="text-sm font-semibold text-gray-700 mb-2 mt-2">Activitat</Text>
              {activityComments.map((c) => (
                <ActivityEntry key={c.id} comment={c} />
              ))}
            </>
          )}

          {/* Comentaris de discussió */}
          <Text className="text-sm font-semibold text-gray-700 mb-2 mt-2">
            Comentaris ({discussionComments.length})
          </Text>
          {discussionComments.length === 0 ? (
            <Text className="text-xs text-gray-400 mb-3">Encara no hi ha comentaris</Text>
          ) : (
            discussionComments.map((c) => (
              <View key={c.id} className="rounded-2xl bg-white border border-gray-100 p-3 mb-2">
                <View className="flex-row items-center mb-1">
                  <Text className="text-sm font-semibold text-gray-800">
                    @{c.author?.nickname ?? 'anonim'}
                  </Text>
                  <Text className="text-xs text-gray-400 ml-2">· {formatRelativeTime(c.createdAt)}</Text>
                </View>
                <Text className="text-sm text-gray-700">{c.content}</Text>
              </View>
            ))
          )}

          {/* Input de comentari (només autor del report, tècnic assignat o admin) */}
          {canComment && (
            <View className="rounded-2xl bg-white border border-gray-100 p-3 mb-3 mt-1">
              <TextInput
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder="Escriu un comentari…"
                placeholderTextColor="#9ca3af"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                className="text-sm text-gray-900"
                style={{ minHeight: 60 }}
                editable={!sendingComment}
              />
              <View className="flex-row justify-end mt-2">
                <Pressable
                  onPress={submitComment}
                  disabled={sendingComment || commentDraft.trim().length === 0}
                  className="rounded-full px-4 py-2 flex-row items-center"
                  style={{
                    backgroundColor:
                      sendingComment || commentDraft.trim().length === 0 ? '#9ca3af' : '#1d4ed8',
                  }}
                >
                  {sendingComment ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="send-outline" size={14} color="#ffffff" />
                      <Text className="text-white text-xs font-semibold ml-1.5">Enviar</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {/* Banner informatiu per al reporter quan la incidència està VALIDATED */}
          {isCreator && report.state === 'VALIDATED' && (
            <View className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 mb-4 mt-3 flex-row items-start">
              <Ionicons
                name="checkmark-circle-outline"
                size={22}
                color="#059669"
                style={{ marginRight: 10, marginTop: 2 }}
              />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-emerald-800 mb-1">
                  El tècnic ha marcat la incidència com a resolta
                </Text>
                <Text className="text-xs text-emerald-700 leading-4">
                  L'administrador la tancarà aviat. Si veus que el problema no està resolt o
                  vols afegir informació, deixa un comentari aquí sota.
                </Text>
              </View>
            </View>
          )}

          {/* Accions TECHNICAL */}
          {isTechnical && isAssignedToMe && report.state !== 'CLOSED' && (
            <View className="rounded-2xl bg-white border border-brand-200 p-4 mb-4 mt-3">
              <Text className="text-sm font-semibold text-gray-800 mb-3">Actualitzar estat</Text>
              <View className="flex-row flex-wrap gap-2">
                {report.state === 'ASSIGNED' && (
                  <ActionButton
                    label="Començar"
                    icon="play-outline"
                    onPress={() => dispatchEvent('START')}
                    color="#3b82f6"
                    disabled={acting}
                  />
                )}
                {report.state === 'IN_PROGRESS' && (
                  <>
                    <ActionButton
                      label={uploadingProgress ? 'Pujant…' : 'Foto de progrés'}
                      icon="camera-outline"
                      onPress={offerProgressPhoto}
                      color="#6366f1"
                      disabled={acting || uploadingProgress}
                    />
                    <ActionButton
                      label="Marcar resolta"
                      icon="checkmark-done-outline"
                      onPress={() => setResolveOpen(true)}
                      color="#059669"
                      disabled={acting || uploadingProgress}
                    />
                  </>
                )}
                {report.state === 'VALIDATED' && (
                  <View className="flex-row items-center bg-gray-50 px-3 py-2 rounded-lg">
                    <Ionicons name="time-outline" size={16} color="#6b7280" />
                    <Text className="text-xs text-gray-600 ml-2">
                      Pendent de tancament per part de l'administrador
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal de resolució */}
      <Modal visible={resolveOpen} animationType="slide" transparent onRequestClose={() => setResolveOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
        >
          <View className="bg-white rounded-t-3xl p-5" style={{ paddingBottom: Platform.OS === 'ios' ? 36 : 24 }}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-bold text-gray-900">Marcar com a resolta</Text>
              <Pressable onPress={() => setResolveOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>
            <Text className="text-sm text-gray-500 mb-4">
              Adjunta una foto del resultat i, opcionalment, descriu com s'ha resolt.
            </Text>

            {/* Foto */}
            <Text className="text-xs font-semibold text-gray-700 mb-2">Foto de resolució *</Text>
            {resolvePhotoUri ? (
              <View className="rounded-2xl overflow-hidden mb-4 bg-gray-200">
                <Image source={{ uri: resolvePhotoUri }} style={{ width: '100%', height: 160 }} resizeMode="cover" />
                <Pressable
                  onPress={() => setResolvePhotoUri(null)}
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
            ) : (
              <View className="flex-row gap-3 mb-4">
                <Pressable
                  onPress={() => pickResolvePhoto('camera')}
                  className="flex-1 rounded-2xl bg-white border border-gray-200 py-5 items-center"
                >
                  <Ionicons name="camera-outline" size={24} color="#1d4ed8" />
                  <Text className="text-xs text-gray-700 mt-1">Càmera</Text>
                </Pressable>
                <Pressable
                  onPress={() => pickResolvePhoto('library')}
                  className="flex-1 rounded-2xl bg-white border border-gray-200 py-5 items-center"
                >
                  <Ionicons name="image-outline" size={24} color="#1d4ed8" />
                  <Text className="text-xs text-gray-700 mt-1">Galeria</Text>
                </Pressable>
              </View>
            )}

            {/* Comentari */}
            <Text className="text-xs font-semibold text-gray-700 mb-2">Comentari (opcional)</Text>
            <TextInput
              value={resolveComment}
              onChangeText={setResolveComment}
              placeholder="Ex: Bombeta substituïda i provada"
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 mb-5"
              style={{ minHeight: 80 }}
            />

            <Pressable
              onPress={submitResolve}
              disabled={acting || !resolvePhotoUri}
              className="rounded-xl py-4 active:opacity-90 flex-row items-center justify-center"
              style={{ backgroundColor: !resolvePhotoUri ? '#9ca3af' : '#059669' }}
            >
              {acting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={18} color="#ffffff" />
                  <Text className="text-white font-semibold ml-2">Confirmar resolució</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function ActivityEntry({ comment }: { comment: ReportComment }) {
  const meta = comment.transitionEvent ? TRANSITION_META[comment.transitionEvent] : null;
  if (!meta) return null;
  return (
    <View className="flex-row mb-3">
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: meta.color + '22',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 10,
          marginTop: 2,
        }}
      >
        <Ionicons name={meta.icon} size={14} color={meta.color} />
      </View>
      <View className="flex-1 rounded-2xl bg-white border border-gray-100 p-3">
        <View className="flex-row items-center mb-1 flex-wrap">
          <Text className="text-xs font-semibold" style={{ color: meta.color }}>
            {meta.label.toUpperCase()}
          </Text>
          <Text className="text-xs text-gray-400 ml-2">· @{comment.author?.nickname ?? 'sistema'}</Text>
          <Text className="text-xs text-gray-400 ml-2">· {formatRelativeTime(comment.createdAt)}</Text>
        </View>
        <Text className="text-sm text-gray-700">{comment.content}</Text>
      </View>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1.5">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm text-gray-900 font-medium">{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  color,
  disabled,
}: {
  label: string;
  icon: IoniconName;
  onPress: () => void;
  color: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="rounded-xl px-4 py-2.5 active:opacity-80 flex-row items-center"
      style={{ backgroundColor: color, opacity: disabled ? 0.6 : 1 }}
    >
      <Ionicons name={icon} size={14} color="#ffffff" />
      <Text className="text-white text-sm font-semibold ml-2">{label}</Text>
    </Pressable>
  );
}
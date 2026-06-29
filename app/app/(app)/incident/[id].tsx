import { useMemo, useRef, useState } from 'react';
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
  FlatList,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../../src/context/AuthContext';
import { useReport } from '../../../src/hooks/useReports';
import { addComment, transitionReport, uploadReportImage } from '../../../src/api/reports';
import { IncidentMiniMap } from '../../../src/components/IncidentMiniMap';
import {
  CATEGORY_IONICONS,
  PRIORITY_COLORS,
  STATE_COLORS,
  formatRelativeTime,
} from '../../../src/mocks/reports';
import type { IncidentEvent, ReportComment } from '../../../src/types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TRANSITION_META: Record<IncidentEvent, { label: string; icon: IoniconName; color: string }> = {
  ASSIGN: { label: 'Assignada', icon: 'person-add-outline', color: '#eab308' },
  START: { label: 'Iniciada', icon: 'play-outline', color: '#3b82f6' },
  REASSIGN: { label: 'Reassignada', icon: 'swap-horizontal-outline', color: '#a855f7' },
  RESOLVE: { label: 'Resolta', icon: 'checkmark-done-outline', color: '#059669' },
  CLOSE: { label: 'Tancada', icon: 'lock-closed-outline', color: '#6b7280' },
  REJECT: { label: 'Rebutjada', icon: 'close-circle-outline', color: '#dc2626' },
};

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { report, loading, error, refresh, setReport } = useReport(id);
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
        <ActivityIndicator color="#15803d" />
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={{ flex: 1 }} className="bg-gray-50 items-center justify-center">
        <Ionicons name="alert-circle-outline" size={32} color="#9ca3af" />
        <Text className="text-gray-500 mt-2">{error ?? t('incident.notFound')}</Text>
        <Pressable onPress={() => router.back()} className="mt-4 flex-row items-center">
          <Ionicons name="arrow-back" size={16} color="#15803d" />
          <Text className="text-brand-600 font-semibold ml-1">{t('incident.back')}</Text>
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
      Alert.alert(t('incident.errorTitle'), e?.response?.data?.error ?? e?.message ?? t('incident.updateError'));
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
      Alert.alert(t('incident.errorTitle'), e?.response?.data?.error ?? e?.message ?? t('incident.commentError'));
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
      Alert.alert(t('incident.permissionDeniedTitle'), t('incident.permissionDeniedBody'));
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
      Alert.alert(t('incident.errorTitle'), e?.response?.data?.error ?? e?.message ?? t('incident.uploadError'));
    } finally {
      setUploadingProgress(false);
    }
  };

  const offerProgressPhoto = () => {
    Alert.alert(
      t('incident.addProgressTitle'),
      t('incident.addProgressBody'),
      [
        { text: t('create.camera'), onPress: () => uploadProgressPhoto('camera') },
        { text: t('create.gallery'), onPress: () => uploadProgressPhoto('library') },
        { text: t('incident.cancel'), style: 'cancel' },
      ],
    );
  };

  const pickResolvePhoto = async (mode: 'camera' | 'library') => {
    const perm =
      mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t('incident.permissionDeniedTitle'), t('incident.permissionDeniedBody'));
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
      Alert.alert(t('incident.photoRequiredTitle'), t('incident.photoRequiredBody'));
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
      Alert.alert(t('incident.errorTitle'), e?.response?.data?.error ?? e?.message ?? t('incident.resolveError'));
    } finally {
      setActing(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      {/* Topbar */}
      <View className="flex-row items-center px-4 py-3 bg-surface border-b border-gray-100">
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-2 mr-2">
          <Ionicons name="arrow-back" size={22} color="#9ca3af" />
        </Pressable>
        <Text className="text-lg font-bold text-gray-900 flex-1" numberOfLines={1}>
          {t('incident.detail')}
        </Text>
        <Pressable onPress={refresh} hitSlop={10} className="p-2">
          <Ionicons name="refresh-outline" size={20} color="#9ca3af" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Imatges: carrusel lliscant amb fletxes laterals i comptador */}
        {images.length > 0 && <ImageCarousel images={images} />}

        <View className="px-5 pt-4">
          {/* Títol i badges */}
          <Text className="text-xl font-bold text-gray-900 mb-2">{report.title}</Text>
          <View className="flex-row items-center flex-wrap gap-2 mb-3">
            {report.category && (
              <View className="flex-row items-center rounded-full bg-gray-100 px-3 py-1">
                <Ionicons
                  name={CATEGORY_IONICONS[report.category]}
                  size={12}
                  color="#6b7280"
                  style={{ marginRight: 4 }}
                />
                <Text className="text-xs font-medium text-gray-700">
                  {t(`categories.${report.category}`)}
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
                {t(`priorities.${report.priority}`)}
              </Text>
            </View>
            <View className="rounded-full px-3 py-1" style={{ backgroundColor: stateColor.bg }}>
              <Text className="text-xs font-bold" style={{ color: stateColor.text }}>
                {t(`states.${report.state}`).toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Descripció */}
          <Text className="text-sm font-semibold text-gray-700 mt-2 mb-1">{t('incident.description')}</Text>
          <Text className="text-sm text-gray-700 leading-5 mb-4">{report.description}</Text>

          {/* Ubicació */}
          <Text className="text-sm font-semibold text-gray-700 mt-2 mb-2">{t('incident.location')}</Text>
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
          <View className="rounded-2xl bg-surface border border-gray-100 p-4 mb-4 mt-3">
            <MetaRow label={t('incident.reportedBy')} value={`@${report.createdBy.nickname}`} />
            {/* Email visible només a admin o al tècnic assignat — útil per a aclariments */}
            {report.createdBy.email && (user?.role === 'ADMIN' || isAssignedToMe) && (
              <Pressable onPress={() => Linking.openURL(`mailto:${report.createdBy.email}`)}>
                <View className="flex-row justify-between py-1.5 items-center">
                  <Text className="text-sm text-gray-500">{t('incident.contact')}</Text>
                  <View className="flex-row items-center">
                    <Ionicons name="mail-outline" size={14} color="#15803d" style={{ marginRight: 4 }} />
                    <Text className="text-sm text-brand-600 font-medium">{report.createdBy.email}</Text>
                  </View>
                </View>
              </Pressable>
            )}
            <MetaRow label={t('incident.date')} value={formatRelativeTime(report.createdAt)} />
            <MetaRow
              label={t('incident.assignedTo')}
              value={report.assignedTo ? `@${report.assignedTo.nickname}` : t('incident.unassigned')}
            />
            {report.resolvedAt && (
              <MetaRow label={t('incident.resolved')} value={formatRelativeTime(report.resolvedAt)} />
            )}
          </View>

          {/* Activitat (timeline de transicions amb comentari) */}
          {activityComments.length > 0 && (
            <>
              <Text className="text-sm font-semibold text-gray-700 mb-2 mt-2">{t('incident.activity')}</Text>
              {activityComments.map((c) => (
                <ActivityEntry key={c.id} comment={c} />
              ))}
            </>
          )}

          {/* Comentaris de discussió */}
          <Text className="text-sm font-semibold text-gray-700 mb-2 mt-2">
            {t('incident.comments', { count: discussionComments.length })}
          </Text>
          {discussionComments.length === 0 ? (
            <Text className="text-xs text-gray-400 mb-3">{t('incident.noComments')}</Text>
          ) : (
            discussionComments.map((c) => (
              <View key={c.id} className="rounded-2xl bg-surface border border-gray-100 p-3 mb-2">
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
            <View className="rounded-2xl bg-surface border border-gray-100 p-3 mb-3 mt-1">
              <TextInput
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder={t('incident.commentPlaceholder')}
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
                      sendingComment || commentDraft.trim().length === 0 ? '#9ca3af' : '#15803d',
                  }}
                >
                  {sendingComment ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="send-outline" size={14} color="#ffffff" />
                      <Text className="text-white text-xs font-semibold ml-1.5">{t('incident.send')}</Text>
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
                  {t('incident.validatedBannerTitle')}
                </Text>
                <Text className="text-xs text-emerald-700 leading-4">
                  {t('incident.validatedBannerBody')}
                </Text>
              </View>
            </View>
          )}

          {/* Accions TECHNICAL */}
          {isTechnical && isAssignedToMe && report.state !== 'CLOSED' && (
            <View className="rounded-2xl bg-surface border border-brand-200 p-4 mb-4 mt-3">
              <Text className="text-sm font-semibold text-gray-800 mb-3">{t('incident.updateState')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {report.state === 'ASSIGNED' && (
                  <ActionButton
                    label={t('incident.start')}
                    icon="play-outline"
                    onPress={() => dispatchEvent('START')}
                    color="#3b82f6"
                    disabled={acting}
                  />
                )}
                {report.state === 'IN_PROGRESS' && (
                  <>
                    <ActionButton
                      label={uploadingProgress ? t('incident.uploading') : t('incident.progressPhoto')}
                      icon="camera-outline"
                      onPress={offerProgressPhoto}
                      color="#15803d"
                      disabled={acting || uploadingProgress}
                    />
                    <ActionButton
                      label={t('incident.markResolved')}
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
                      {t('incident.pendingClose')}
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
          <View className="bg-surface rounded-t-3xl p-5" style={{ paddingBottom: Platform.OS === 'ios' ? 36 : 24 }}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-lg font-bold text-gray-900">{t('incident.resolveModalTitle')}</Text>
              <Pressable onPress={() => setResolveOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </Pressable>
            </View>
            <Text className="text-sm text-gray-500 mb-4">
              {t('incident.resolveModalSubtitle')}
            </Text>

            {/* Foto */}
            <Text className="text-xs font-semibold text-gray-700 mb-2">{t('incident.resolutionPhoto')}</Text>
            {resolvePhotoUri ? (
              <View className="mb-4">
              <View className="rounded-2xl overflow-hidden bg-gray-200">
                <Image source={{ uri: resolvePhotoUri }} style={{ width: '100%', height: 160 }} resizeMode="cover" />
                <View
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <Ionicons name="checkmark-circle" size={13} color="#34d399" />
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginLeft: 4 }}>
                    {t('incident.photoAttached')}
                  </Text>
                </View>
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
              </View>
            ) : (
              <View className="flex-row gap-3 mb-4">
                <Pressable
                  onPress={() => pickResolvePhoto('camera')}
                  className="flex-1 rounded-2xl bg-surface border border-gray-200 py-5 items-center"
                >
                  <Ionicons name="camera-outline" size={24} color="#15803d" />
                  <Text className="text-xs text-gray-700 mt-1">{t('create.camera')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => pickResolvePhoto('library')}
                  className="flex-1 rounded-2xl bg-surface border border-gray-200 py-5 items-center"
                >
                  <Ionicons name="image-outline" size={24} color="#15803d" />
                  <Text className="text-xs text-gray-700 mt-1">{t('create.gallery')}</Text>
                </Pressable>
              </View>
            )}

            {/* Comentari */}
            <Text className="text-xs font-semibold text-gray-700 mb-2">{t('incident.commentOptional')}</Text>
            <TextInput
              value={resolveComment}
              onChangeText={setResolveComment}
              placeholder={t('incident.commentResolvePlaceholder')}
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              className="rounded-xl border border-gray-300 bg-surface px-4 py-3 text-sm text-gray-900 mb-5"
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
                  <Text className="text-white font-semibold ml-2">{t('incident.confirmResolution')}</Text>
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
      <View className="flex-1 rounded-2xl bg-surface border border-gray-100 p-3">
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

const IMAGE_TYPE_LABEL: Record<string, string> = {
  INITIAL: 'INICIAL',
  RESOLUTION: 'RESOLUCIÓ',
  PROGRESS: 'PROGRÉS',
};

/**
 * Carrusel d'imatges de la incidència. Es pot navegar:
 *  - lliscant el dit cap als costats (FlatList horitzontal amb paging)
 *  - amb les fletxes laterals (◀ ▶) que apareixen segons la posició
 *  - tocant els punts inferiors
 * Mostra un comptador "actual / total" i, a sota, quantes fotos hi ha adjuntes.
 */
function ImageCarousel({ images }: { images: { url: string; type: string }[] }) {
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const listRef = useRef<FlatList>(null);

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(images.length - 1, i));
    listRef.current?.scrollToOffset({ offset: clamped * width, animated: true });
    setIdx(clamped);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== idx) setIdx(next);
  };

  const hasMany = images.length > 1;

  return (
    <View className="bg-surface">
      <View>
        <FlatList
          ref={listRef}
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={onScrollEnd}
          renderItem={({ item }) => (
            <Image
              source={{ uri: item.url }}
              style={{ width, height: 240, backgroundColor: '#e5e7eb' }}
              resizeMode="cover"
            />
          )}
        />

        {/* Comptador actual / total (a dalt a l'esquerra) */}
        {hasMany && (
          <View
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              backgroundColor: 'rgba(0,0,0,0.6)',
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
              {idx + 1} / {images.length}
            </Text>
          </View>
        )}

        {/* Etiqueta de tipus de la imatge actual (a dalt a la dreta) */}
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
            {IMAGE_TYPE_LABEL[images[idx]?.type] ?? 'PROGRÉS'}
          </Text>
        </View>

        {/* Fletxa esquerra */}
        {hasMany && idx > 0 && (
          <Pressable
            onPress={() => goTo(idx - 1)}
            hitSlop={8}
            style={{
              position: 'absolute',
              left: 8,
              top: 240 / 2 - 18,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
        )}

        {/* Fletxa dreta */}
        {hasMany && idx < images.length - 1 && (
          <Pressable
            onPress={() => goTo(idx + 1)}
            hitSlop={8}
            style={{
              position: 'absolute',
              right: 8,
              top: 240 / 2 - 18,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-forward" size={22} color="#fff" />
          </Pressable>
        )}
      </View>

      {/* Punts indicadors */}
      {hasMany && (
        <View className="flex-row items-center justify-center py-2">
          {images.map((_, i) => (
            <Pressable key={i} onPress={() => goTo(i)} className="mx-1" hitSlop={6}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: i === idx ? '#15803d' : '#d1d5db',
                }}
              />
            </Pressable>
          ))}
        </View>
      )}

      {/* Recompte de fotos adjuntes */}
      <View className="flex-row items-center justify-center pb-2">
        <Ionicons name="images-outline" size={13} color="#6b7280" />
        <Text className="text-xs text-gray-500 ml-1">
          {images.length === 1
            ? t('incident.photosAttachedOne', { count: images.length })
            : t('incident.photosAttachedMany', { count: images.length })}
        </Text>
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
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Report } from '../types';
import {
  CATEGORY_IONICONS,
  CATEGORY_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATE_COLORS,
  STATE_LABELS,
  formatRelativeTime,
} from '../mocks/reports';

export function ReportCard({ report }: { report: Report }) {
  const stateColor = STATE_COLORS[report.state];
  return (
    <Pressable
      onPress={() => router.push(`/incident/${report.report_id}`)}
      className="rounded-2xl bg-white p-4 mb-3 border border-gray-100"
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center mb-1">
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: PRIORITY_COLORS[report.priority],
                marginRight: 6,
              }}
            />
            <Text style={{ color: PRIORITY_COLORS[report.priority], fontSize: 11, fontWeight: '700' }}>
              {PRIORITY_LABELS[report.priority].toUpperCase()}
            </Text>
          </View>
          <Text className="text-base font-semibold text-gray-900" numberOfLines={2}>
            {report.title}
          </Text>
        </View>
        <View style={{ backgroundColor: stateColor.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
          <Text style={{ color: stateColor.text, fontSize: 10, fontWeight: '700' }}>
            {STATE_LABELS[report.state].toUpperCase()}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center">
        {report.category && (
          <>
            <Ionicons
              name={CATEGORY_IONICONS[report.category]}
              size={14}
              color="#6b7280"
              style={{ marginRight: 4 }}
            />
            <Text className="text-sm text-gray-600">{CATEGORY_LABELS[report.category]}</Text>
            <Text className="text-sm text-gray-400 mx-2">·</Text>
          </>
        )}
        <Text className="text-sm text-gray-500 flex-1" numberOfLines={1}>
          @{report.createdBy.nickname}
        </Text>
      </View>
      <Text className="text-xs text-gray-400 mt-1">{formatRelativeTime(report.createdAt)}</Text>
    </Pressable>
  );
}

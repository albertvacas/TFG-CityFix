import { View, Text, ScrollView, SafeAreaView, Pressable, Image } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/** Apartat "Sobre CampusFix" — descripció de l'aplicació i els seus fins. */
export default function AboutScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-gray-50">
      {/* Topbar */}
      <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-2 mr-2">
          <Ionicons name="arrow-back" size={22} color="#9ca3af" />
        </Pressable>
        <Text className="text-lg font-bold text-gray-900 flex-1">Sobre CampusFix</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Capçalera de marca */}
        <View className="items-center mb-6 mt-2">
          <Image
            source={require('../../assets/logo.png')}
            style={{ width: 84, height: 84, borderRadius: 20 }}
          />
          <Text className="text-2xl font-bold text-gray-900 mt-3">CampusFix</Text>
          <Text className="text-sm text-gray-500 mt-1">
            Gestió d'incidències del Campus UAB
          </Text>
        </View>

        {/* Què és */}
        <Section title="Què és?">
          CampusFix és una plataforma per reportar i gestionar incidències a les
          instal·lacions del campus de la UAB. Connecta la comunitat universitària
          amb l'equip de manteniment perquè qualsevol problema —des d'un fanal
          trencat fins a una vorera malmesa— es resolgui de forma àgil i transparent.
        </Section>

        {/* Finalitat */}
        <Section title="Els nostres fins">
          <Bullet>Facilitar que estudiants i personal informin d'incidències en pocs segons, amb foto i ubicació.</Bullet>
          <Bullet>Agilitzar l'assignació i el seguiment de cada incidència fins a la seva resolució.</Bullet>
          <Bullet>Millorar el manteniment del campus prioritzant les incidències més crítiques.</Bullet>
          <Bullet>Fomentar la participació amb un sistema de punts que premia qui ajuda a millorar el campus.</Bullet>
        </Section>

        {/* Com funciona */}
        <Section title="Com funciona?">
          <Bullet>Reportes una incidència amb una foto i la seva localització al mapa.</Bullet>
          <Bullet>Un administrador la revisa i l'assigna a un tècnic especialitzat.</Bullet>
          <Bullet>El tècnic la resol i tu reps punts quan es valida i es tanca.</Bullet>
        </Section>

        <Text className="text-center text-xs text-gray-400 mt-4">
          CampusFix · Universitat Autònoma de Barcelona
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-2xl bg-surface dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 mb-4">
      <Text className="text-base font-bold text-gray-900 mb-2">{title}</Text>
      {typeof children === 'string' ? (
        <Text className="text-sm text-gray-600 leading-5">{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-row mb-2">
      <Text className="text-brand-600 mr-2">•</Text>
      <Text className="text-sm text-gray-600 leading-5 flex-1">{children}</Text>
    </View>
  );
}

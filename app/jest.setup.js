// Setup global dels tests de la app mòbil.
//
// @testing-library/react-native (v14) ja inclou els matchers (toBeOnTheScreen,
// toHaveTextContent...), així que no cal estendre res manualment.
//
// Silenciem l'avís de NativeWind sobre l'absència del runtime de CSS al entorn
// de test (no afecta les assercions de contingut, que és el que validem).
jest.spyOn(console, 'warn').mockImplementation((msg) => {
  if (typeof msg === 'string' && msg.includes('NativeWind')) return;
  // Deixem passar la resta d'avisos.
});

// Inicialitzem i18n perquè els components que usen `useTranslation` (ReportCard…)
// renderitzin els textos traduïts (idioma per defecte: català) en lloc de la clau.
// Mockegem els mòduls natius que la config d'i18n toca a l'arrencada.
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'ca' }] }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
require('./src/i18n');

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  // Partim del transformIgnorePatterns per defecte de jest-expo i hi afegim
  // NativeWind i react-native-css-interop perquè el className compilat per
  // Babel també es transformi dins els tests.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|nativewind|react-native-css-interop))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
};

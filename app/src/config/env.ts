import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Retorna la URL del backend segons la plataforma d'execució.
 * - Emulador Android: 10.0.2.2 apunta al localhost del host
 * - iOS Simulator: localhost funciona directament
 * - Dispositiu físic (Expo Go): cal la IP de la màquina de desenvolupament
 *
 * Per a dispositiu físic, configura la variable d'entorn EXPO_PUBLIC_API_URL
 * o modifica el valor per defecte.
 */
const getApiUrl = (): string => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  const debuggerHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (debuggerHost) return `http://${debuggerHost}:3000/api`;

  if (Platform.OS === 'android') return 'http://10.0.2.2:3000/api';
  return 'http://localhost:3000/api';
};

export const API_URL = getApiUrl();

import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../config/env';

export const TOKEN_KEY = 'cityfix_token';

// Handler que el AuthContext registra per reaccionar a un 401 (compte bloquejat
// o eliminat, o token expirat): reseteja l'estat de sessió perquè el guard de
// navegació porti l'usuari a la pantalla de login.
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (cb: (() => void) | null) => {
  onUnauthorized = cb;
};

const client = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

// Injecta el JWT a cada petició
client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Gestió global de 401: esborra el token i deixa que el context redirigeixi
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

export default client;

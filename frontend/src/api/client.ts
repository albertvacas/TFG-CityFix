import axios from 'axios';

/**
 * Base de l'API. Si `VITE_API_URL` està definida (web i backend en dominis
 * diferents, p. ex. Vercel + Render), s'hi apunta directament; si no, s'usa
 * `/api` relatiu (proxy de Vite en dev / mateix domini en prod).
 */
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

const client = axios.create({
  baseURL: API_BASE,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default client;

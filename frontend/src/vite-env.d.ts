/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base de l'API del backend (p. ex. `https://backend.onrender.com/api`).
   * Si no es defineix, s'utilitza `/api` relatiu (proxy de Vite en dev,
   * mateix domini en prod). Cal definir-la quan el web i el backend viuen
   * en dominis diferents (p. ex. Vercel + Render) perquè el SSE i les
   * peticions apuntin directament al backend.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { envs } from '../config/env';

let cachedClient: SupabaseClient | null = null;

const getClient = (): SupabaseClient => {
  if (cachedClient) return cachedClient;
  if (!envs.SUPABASE_URL || !envs.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase no está configurat: defineix SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY al .env',
    );
  }
  cachedClient = createClient(envs.SUPABASE_URL, envs.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
};

const extensionFromMimetype = (mimetype: string): string => {
  if (mimetype === 'image/jpeg') return 'jpg';
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  if (mimetype === 'image/heic' || mimetype === 'image/heif') return 'heic';
  return 'bin';
};

/**
 * Puja un buffer al bucket configurat i retorna la URL pública.
 * El path resultant és: <reportId>/<uuid>.<ext>
 */
export const uploadReportImage = async (
  reportId: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string> => {
  const client = getClient();
  const bucket = envs.SUPABASE_STORAGE_BUCKET;
  const ext = extensionFromMimetype(mimetype);
  const path = `${reportId}/${randomUUID()}.${ext}`;

  const { error } = await client.storage.from(bucket).upload(path, buffer, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw new Error(`Error pujant a Supabase Storage: ${error.message}`);

  const { data } = client.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('No s\'ha pogut obtenir la URL pública de la imatge');
  return data.publicUrl;
};

/**
 * Puja l'avatar (foto de perfil) d'un usuari i retorna la URL pública.
 * Reutilitza el mateix bucket que les imatges de report; el path va sota
 * `avatars/<userId>/<uuid>.<ext>` per separar-los de les imatges d'incidència.
 */
export const uploadAvatarImage = async (
  userId: string,
  buffer: Buffer,
  mimetype: string,
): Promise<string> => {
  const client = getClient();
  const bucket = envs.SUPABASE_STORAGE_BUCKET;
  const ext = extensionFromMimetype(mimetype);
  const path = `avatars/${userId}/${randomUUID()}.${ext}`;

  const { error } = await client.storage.from(bucket).upload(path, buffer, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw new Error(`Error pujant a Supabase Storage: ${error.message}`);

  const { data } = client.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('No s\'ha pogut obtenir la URL pública de l\'avatar');
  return data.publicUrl;
};

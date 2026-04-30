//Validacion variables de entorno
import 'dotenv/config';

export const envs = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'tu_palabra_secreta_para_tokens',
  ROOT_ADMIN_EMAIL: process.env.ROOT_ADMIN_EMAIL || 'admin.master@uab.cat',
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'report-images',
};

// Validación simple: Si no hay URL de base de datos, la app no debe ni arrancar
if (!envs.DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida en el archivo .env');
}

// Las imágenes son opcionales; sólo avisamos si Supabase no está configurado.
if (!envs.SUPABASE_URL || !envs.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[env] SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no definidas: la subida d\'imatges fallarà fins que es configurin.',
  );
}
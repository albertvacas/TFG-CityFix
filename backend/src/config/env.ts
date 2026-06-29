//Validacion variables de entorno
import 'dotenv/config';

export const envs = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  ROOT_ADMIN_EMAIL: process.env.ROOT_ADMIN_EMAIL || 'admin.master@uab.cat',
  // Origen(s) permès(os) per CORS, separats per comes. Si no es defineix,
  // s'accepta qualsevol origen (còmode en dev, però no recomanat en producció).
  FRONTEND_URL: process.env.FRONTEND_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'report-images',
  // Gemini (Google AI Studio) — necessària per al sistema d'auto-classificació.
  // Si no està configurada, la classificació es desactiva amb avís però la
  // resta de l'app segueix funcionant.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

// Validación simple: Si no hay URL de base de datos, la app no debe ni arrancar
if (!envs.DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida en el archivo .env');
}

// El secret JWT és crític per a la seguretat: sense ell, els tokens es
// firmarien amb un valor conegut. No arranquem sense un secret explícit.
if (!envs.JWT_SECRET) {
  throw new Error('JWT_SECRET no está definida en el archivo .env');
}

// Las imágenes son opcionales; sólo avisamos si Supabase no está configurado.
if (!envs.SUPABASE_URL || !envs.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[env] SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no definidas: la subida d\'imatges fallarà fins que es configurin.',
  );
}

// Gemini és opcional: si no hi és, la classificació IA es desactiva.
if (!envs.GEMINI_API_KEY) {
  console.warn(
    '[env] GEMINI_API_KEY no definida: el sistema d\'auto-classificació IA quedarà desactivat.',
  );
}
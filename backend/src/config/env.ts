//Validacion variables de entorno 
import 'dotenv/config';

export const envs = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'tu_palabra_secreta_para_tokens',
  ROOT_ADMIN_EMAIL: process.env.ROOT_ADMIN_EMAIL || 'admin.master@uab.cat',
};

// Validación simple: Si no hay URL de base de datos, la app no debe ni arrancar
if (!envs.DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida en el archivo .env');
}
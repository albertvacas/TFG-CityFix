import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { envs } from './env';

// Prisma v7: requiere un driver adapter
const adapter = new PrismaPg({ connectionString: envs.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

// Verificar la conexión al arrancar
export const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log('Conexion a Supabase establecida correctamente');
  } catch (error) {
    console.error('Error conectando a la base de datos:', error);
    process.exit(1);
  }
};

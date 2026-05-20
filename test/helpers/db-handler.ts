import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * @file test/helpers/db-handler.ts
 * @description Helper para gestionar la base de datos en memoria (MongoMemoryServer).
 * 
 * ¿Por qué esto es profesional?
 * 1. Aislamiento: Cada suite de tests tiene su propia base de datos limpia.
 * 2. Velocidad: No hay latencia de red, todo ocurre en RAM.
 * 3. Seguridad: No hay riesgo de borrar datos reales.
 */

let mongod: MongoMemoryServer;

/**
 * Conecta a la base de datos en memoria.
 * @returns La URI de conexión.
 */
export const connect = async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  return uri;
};

/**
 * Cierra la conexión y detiene el servidor de memoria.
 */
export const closeDatabase = async () => {
  if (mongod) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  }
};

/**
 * Limpia todas las colecciones. Útil para ejecutar entre cada test.
 */
export const clearDatabase = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
};

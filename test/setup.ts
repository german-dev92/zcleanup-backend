/**
 * @file test/setup.ts
 * @description Archivo de configuración global que se ejecuta ANTES de cada test.
 * Propósito:
 * 1. Definir variables de entorno seguras para el entorno de pruebas.
 * 2. Evitar que los tests dependan de un archivo .env externo.
 * 3. Configurar mocks globales si fuera necesario.
 */

// Seteamos variables de entorno fijas para los tests.
// Esto garantiza que el entorno de testing sea predecible y no rompa nada en producción.
process.env.JWT_SECRET = 'test-secret-key-for-unit-testing-only';
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017/test'; // Será sobrescrito por Memory Server
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock';
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'password';
process.env.FRONTEND_URL = 'http://localhost:4200';

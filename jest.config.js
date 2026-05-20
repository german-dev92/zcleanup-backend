/**
 * @file jest.config.js
 * @description Configuración central de Jest para el Backend (NestJS).
 * Jest es el framework que ejecuta los tests. Este archivo le dice a Jest:
 * - Dónde buscar los tests.
 * - Cómo transformar el código TypeScript a JavaScript (usando ts-jest).
 * - Qué archivos de configuración previa cargar.
 * - Cómo generar los reportes de cobertura (coverage).
 */

module.exports = {
  // Indica que estamos usando TypeScript y queremos transformarlo
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  
  // Recolectar información de qué tanto código estamos probando
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  
  // Entorno de ejecución: 'node' es el estándar para backend
  testEnvironment: 'node',
  
  // Mapeo de módulos para resolver rutas relativas
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },

  // Archivo que se ejecuta antes de empezar los tests
  setupFiles: ['<rootDir>/../test/setup.ts'],
  
  // Ignorar carpetas que no queremos testear o que no tienen lógica
  coveragePathIgnorePatterns: [
    'node_modules',
    'test-config',
    'interfaces',
    'jest.config.js',
    '.module.ts',
    '<rootDir>/main.ts',
    '<rootDir>/openapi.ts',
    '.dto.ts',
    '.schema.ts',
    '.enum.ts',
    '.types.ts'
  ],

  // Configuración de umbrales de cobertura (Thresholds)
  // Si el código probado baja de estos porcentajes, el test fallará.
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 40,
      functions: 50,
      lines: 50,
    },
  },
};

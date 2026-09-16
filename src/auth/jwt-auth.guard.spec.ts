import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * @file jwt-auth.guard.spec.ts
 * @description Test “mínimo pero honesto” para JwtAuthGuard.
 *
 * IMPORTANTE (por qué este test no es más profundo):
 * - JwtAuthGuard es un wrapper muy delgado: `extends AuthGuard('jwt')`.
 * - El comportamiento real depende de passport-jwt + JwtStrategy.
 * - Probar “requests sin token / token inválido / token válido” de forma realista
 *   requiere un test e2e con Nest + strategy configurada y peticiones HTTP.
 *
 * QUÉ PROTEGE ESTE TEST:
 * - Evita regresiones accidentales donde el guard deje de exportarse o se rompa la clase.
 *
 * PRÓXIMO PASO ENTERPRISE:
 * - Agregar e2e tests que golpeen endpoints protegidos (Supertest) con tokens reales.
 */

describe('JwtAuthGuard', () => {
  it('should be defined', () => {
    expect(new JwtAuthGuard()).toBeDefined();
  });
});

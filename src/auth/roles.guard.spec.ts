import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';
import { UserRole } from './roles.enum';

/**
 * @file roles.guard.spec.ts
 * @description Tests de autorización basados en roles.
 *
 * POR QUÉ ES CRÍTICO:
 * - Un bug en RolesGuard puede abrir endpoints de admin a usuarios sin privilegios.
 * - Estos tests protegen seguridad y cumplimiento (principio de menor privilegio).
 *
 * CONCEPTO: Reflect Metadata
 * - NestJS usa decoradores (@Roles) para guardar metadata en handlers/clases.
 * - RolesGuard lee esa metadata con Reflect.getMetadata.
 * - Aquí simulamos esa metadata para probar el guard sin levantar un servidor HTTP.
 */

describe('RolesGuard (Unit Test)', () => {
  const guard = new RolesGuard();

  const makeContext = (params: {
    roles?: string[];
    user?: unknown;
  }): ExecutionContext => {
    const handler = () => undefined;
    const clazz = class Dummy {};

    if (Array.isArray(params.roles)) {
      Reflect.defineMetadata(ROLES_KEY, params.roles, handler);
    }

    return {
      getHandler: () => handler,
      getClass: () => clazz,
      switchToHttp: () => ({
        getRequest: () => ({ user: params.user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('allows when no roles metadata is present', () => {
    // Arrange
    const ctx = makeContext({ roles: undefined, user: undefined });

    // Act
    const ok = guard.canActivate(ctx);

    // Assert
    expect(ok).toBe(true);
  });

  it('rejects when roles required but request has no user', () => {
    // Arrange
    const ctx = makeContext({ roles: [UserRole.ADMIN], user: undefined });

    // Act + Assert
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('allows admin access when user role matches', () => {
    // Arrange
    const ctx = makeContext({
      roles: [UserRole.ADMIN],
      user: { role: UserRole.ADMIN },
    });

    // Act
    const ok = guard.canActivate(ctx);

    // Assert
    expect(ok).toBe(true);
  });

  it('blocks access when user role does not match required roles', () => {
    // Arrange
    const ctx = makeContext({
      roles: [UserRole.ADMIN],
      user: { role: UserRole.EMPLOYEE },
    });

    // Act + Assert
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthRole, AuthUser } from './auth.types';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const clazz = context.getClass();

    const roles =
      (Reflect.getMetadata(ROLES_KEY, handler) as AuthRole[] | undefined) ??
      (Reflect.getMetadata(ROLES_KEY, clazz) as AuthRole[] | undefined) ??
      [];

    if (roles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<unknown>();
    if (!this.isRecord(req)) {
      throw new UnauthorizedException();
    }

    const userValue = req['user'];
    if (!this.isAuthUser(userValue)) {
      throw new UnauthorizedException();
    }

    if (roles.includes(userValue.role)) {
      return true;
    }

    throw new ForbiddenException();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private isAuthUser(value: unknown): value is AuthUser {
    if (!this.isRecord(value)) {
      return false;
    }
    const role = value['role'];
    return role === 'admin' || role === 'user';
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthRole, AuthUser } from './auth.types';

type JwtPayload = {
  userId?: string;
  email?: string;
  role?: AuthRole;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const secret = process.env.JWT_SECRET;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret ?? 'MISSING_JWT_SECRET',
    });
  }

  validate(payload: JwtPayload): AuthUser {
    if (!payload || (payload.role !== 'admin' && payload.role !== 'user')) {
      throw new UnauthorizedException();
    }

    const email =
      typeof payload.email === 'string'
        ? payload.email.toLowerCase().trim()
        : undefined;

    return {
      sub: typeof payload.userId === 'string' ? payload.userId : undefined,
      email,
      role: payload.role,
    };
  }
}

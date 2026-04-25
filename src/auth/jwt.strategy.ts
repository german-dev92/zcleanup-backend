import { InjectModel } from '@nestjs/mongoose';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthRole, AuthUser } from './auth.types';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UserRole } from './roles.enum';

type JwtPayload = {
  sub?: string;
  userId?: string;
  email?: string;
  role?: AuthRole;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {
    const secret = process.env.JWT_SECRET;
    if (typeof secret !== 'string' || !secret.trim()) {
      throw new Error('JWT_SECRET is missing');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload) {
      throw new UnauthorizedException();
    }

    const userId =
      typeof payload.sub === 'string'
        ? payload.sub
        : typeof payload.userId === 'string'
          ? payload.userId
          : '';
    if (!userId) {
      throw new UnauthorizedException();
    }

    const user = await this.users
      .findById(userId)
      .select({ _id: 1, email: 1, role: 1, active: 1 })
      .lean();
    if (!user || user.active === false) {
      throw new UnauthorizedException();
    }

    const email =
      typeof user.email === 'string' ? user.email.toLowerCase().trim() : '';

    return {
      sub: String(user._id),
      email: email || undefined,
      role: this.coerceRole((user as unknown as { role?: unknown }).role),
    };
  }

  private coerceRole(value: unknown): AuthRole {
    if (value === UserRole.ADMIN) return UserRole.ADMIN;
    if (value === UserRole.SUPERVISOR) return UserRole.SUPERVISOR;
    return UserRole.EMPLOYEE;
  }
}

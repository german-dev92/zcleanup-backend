import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../users/schemas/user.schema';
import type { AuthRole } from './auth.types';
import { UserRole } from './roles.enum';

type JwtPayload = {
  sub: string;
  email: string;
  role: AuthRole;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    emailRaw: string,
    passwordRaw: string,
  ): Promise<{
    access_token: string;
    token: string;
    user: { id: string; email: string; role: AuthRole };
  }> {
    if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
      throw new Error('JWT_SECRET is missing');
    }

    const email = String(emailRaw ?? '')
      .toLowerCase()
      .trim();
    const password = String(passwordRaw ?? '');

    const user = await this.users.findOne({ email });

    if (!user || user.active === false) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (typeof user.passwordHash !== 'string' || !user.passwordHash.trim()) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let ok = false;
    try {
      ok = await bcrypt.compare(password, user.passwordHash);
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: String(user._id),
      email: user.email,
      role: this.coerceRole((user as unknown as { role?: unknown }).role),
    };

    const access_token = await this.jwtService.signAsync(payload);
    return {
      access_token,
      token: access_token,
      user: {
        id: String(user._id),
        email: user.email,
        role: this.coerceRole((user as unknown as { role?: unknown }).role),
      },
    };
  }

  private coerceRole(value: unknown): AuthRole {
    if (value === UserRole.ADMIN) return UserRole.ADMIN;
    if (value === UserRole.SUPERVISOR) return UserRole.SUPERVISOR;
    return UserRole.EMPLOYEE;
  }
}

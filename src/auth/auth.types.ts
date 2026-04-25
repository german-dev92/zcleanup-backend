import type { UserRole } from './roles.enum';

export type AuthRole = UserRole;

export type AuthUser = {
  sub?: string;
  email?: string;
  role: AuthRole;
  exp?: number;
};

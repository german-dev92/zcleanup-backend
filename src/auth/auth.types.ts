export type AuthRole = 'admin' | 'user';

export type AuthUser = {
  sub?: string;
  email?: string;
  role: AuthRole;
  exp?: number;
};

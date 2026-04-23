import { SetMetadata } from '@nestjs/common';
import type { AuthRole } from './auth.types';

export const ROLES_KEY = 'roles';

export function Roles(...roles: AuthRole[]) {
  return SetMetadata(ROLES_KEY, roles);
}

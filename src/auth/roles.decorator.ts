import { SetMetadata } from '@nestjs/common';
import type { UserRole } from './roles.enum';

export const ROLES_KEY = 'roles';

export function Roles(...roles: UserRole[]) {
  return SetMetadata(ROLES_KEY, roles);
}

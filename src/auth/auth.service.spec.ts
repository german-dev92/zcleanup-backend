import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { User } from '../users/schemas/user.schema';
import { UserRole } from './roles.enum';

/**
 * @file auth.service.spec.ts
 * @description Tests unitarios profesionales para AuthService.
 *
 * POR QUÉ UNIT TEST AQUÍ:
 * - AuthService es principalmente lógica de validación + hashing + JWT.
 * - No necesitamos DB real para probar: podemos mockear el Model<User>.
 * - Esto hace los tests rápidos, deterministas y aptos para CI.
 *
 * QUÉ PROTEGE:
 * - Que un login válido emita un JWT con payload correcto.
 * - Que credenciales inválidas devuelvan Unauthorized (sin filtrar información sensible).
 * - Que usuarios inactivos no puedan autenticarse.
 */

describe('AuthService (Unit Test)', () => {
  let service: AuthService;

  const userModelMock = {
    findOne: jest.fn(),
  };

  const jwtServiceMock = {
    signAsync: jest.fn().mockResolvedValue('jwt.token.here'),
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'unit-test-secret';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModelMock },
        { provide: JwtService, useValue: jwtServiceMock },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jest.clearAllMocks();
  });

  it('Login Success: generates JWT and returns normalized user data', async () => {
    // Arrange
    const passwordHash = await bcrypt.hash('password123', 1);
    userModelMock.findOne.mockResolvedValueOnce({
      _id: 'user_1',
      // En producción, el email suele guardarse normalizado en minúsculas.
      email: 'test@example.com',
      passwordHash,
      active: true,
      role: UserRole.ADMIN,
    });

    // Act
    const res = await service.login('Test@Example.com', 'password123');

    // Assert
    expect(jwtServiceMock.signAsync).toHaveBeenCalledTimes(1);
    expect(jwtServiceMock.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user_1',
        email: 'test@example.com',
        role: UserRole.ADMIN,
      }),
    );

    expect(res).toMatchObject({
      access_token: 'jwt.token.here',
      token: 'jwt.token.here',
      user: {
        id: 'user_1',
        email: 'test@example.com',
        role: UserRole.ADMIN,
      },
    });
  });

  it('Invalid Credentials: rejects when user does not exist', async () => {
    // Arrange
    userModelMock.findOne.mockResolvedValueOnce(null);

    // Act + Assert
    await expect(service.login('x@y.com', 'pw')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('Invalid Credentials: rejects when user is inactive', async () => {
    // Arrange
    userModelMock.findOne.mockResolvedValueOnce({
      _id: 'user_2',
      email: 'test@example.com',
      passwordHash: 'hash',
      active: false,
      role: UserRole.ADMIN,
    });

    // Act + Assert
    await expect(service.login('test@example.com', 'pw')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('Invalid Credentials: rejects when password does not match', async () => {
    // Arrange
    const passwordHash = await bcrypt.hash('correct', 1);
    userModelMock.findOne.mockResolvedValueOnce({
      _id: 'user_3',
      email: 'test@example.com',
      passwordHash,
      active: true,
      role: UserRole.ADMIN,
    });

    // Act + Assert
    await expect(service.login('test@example.com', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

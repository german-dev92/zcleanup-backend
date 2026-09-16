import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * @file auth.controller.spec.ts
 * @description Tests del controlador de Auth.
 *
 * POR QUÉ EXISTE:
 * - AuthController es un adaptador HTTP: su job es recibir el DTO y delegar al servicio.
 * - Este test evita regresiones donde el controller cambie el contrato o no pase parámetros correctamente.
 */

describe('AuthController (Unit Test)', () => {
  let controller: AuthController;
  const authServiceMock = {
    login: jest.fn().mockResolvedValue({ token: 'jwt', user: {} }),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    controller = moduleRef.get(AuthController);
    jest.clearAllMocks();
  });

  it('delegates login to AuthService with email/password', async () => {
    // Arrange
    const dto = { email: 'test@example.com', password: 'pw' };

    // Act
    await controller.login(dto as any);

    // Assert
    expect(authServiceMock.login).toHaveBeenCalledTimes(1);
    expect(authServiceMock.login).toHaveBeenCalledWith(
      'test@example.com',
      'pw',
    );
  });
});

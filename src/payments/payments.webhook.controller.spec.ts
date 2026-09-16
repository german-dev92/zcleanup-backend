import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PaymentsWebhookController } from './payments.webhook.controller';
import { PaymentsWebhookService } from './payments.webhook.service';

/**
 * @file payments.webhook.controller.spec.ts
 * @description Tests unitarios del controlador de webhooks de Stripe.
 *
 * POR QUÉ SE TESTEA EL CONTROLLER:
 * - Es la primera línea de defensa contra webhooks maliciosos.
 * - Valida requisitos mínimos (signature + rawBody) antes de delegar al servicio.
 *
 * QUÉ RIESGO EVITA EN PRODUCCIÓN:
 * - Evita procesar requests sin firma (posible fraude).
 * - Evita procesar requests sin rawBody (firma no verificable / payload manipulable).
 */

describe('PaymentsWebhookController (Unit Test)', () => {
  let controller: PaymentsWebhookController;
  const webhookServiceMock = {
    handleWebhook: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsWebhookController],
      providers: [
        { provide: PaymentsWebhookService, useValue: webhookServiceMock },
      ],
    }).compile();

    controller = moduleRef.get(PaymentsWebhookController);
    jest.clearAllMocks();
  });

  it('rejects requests without stripe-signature header', async () => {
    // Arrange
    const req = { rawBody: Buffer.from('{}') };

    // Act + Assert
    await expect(controller.handleWebhook(req, undefined)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(webhookServiceMock.handleWebhook).not.toHaveBeenCalled();
  });

  it('rejects requests without rawBody buffer', async () => {
    // Arrange
    const req = { rawBody: undefined };

    // Act + Assert
    await expect(controller.handleWebhook(req, 'sig')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(webhookServiceMock.handleWebhook).not.toHaveBeenCalled();
  });

  it('delegates to PaymentsWebhookService when signature and rawBody are present', async () => {
    // Arrange
    const rawBody = Buffer.from(
      JSON.stringify({ type: 'checkout.session.completed' }),
    );
    const req = { rawBody };
    const signature = 't=123,v1=signature';

    // Act
    const res = await controller.handleWebhook(req, signature);

    // Assert
    expect(webhookServiceMock.handleWebhook).toHaveBeenCalledTimes(1);
    expect(webhookServiceMock.handleWebhook).toHaveBeenCalledWith(
      rawBody,
      signature,
    );
    expect(res).toEqual({ received: true });
  });
});

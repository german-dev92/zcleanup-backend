import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentsWebhookService } from './payments.webhook.service';

type RawBodyRequest = {
  rawBody?: Buffer;
};

@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly webhookService: PaymentsWebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    console.log('[STRIPE WEBHOOK] Received');

    if (!signature) {
      throw new UnauthorizedException();
    }

    const rawBody = req.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      throw new UnauthorizedException();
    }

    await this.webhookService.handleWebhook(rawBody, signature);
    return { received: true };
  }
}

import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailListener } from './email.listener';
import { EmailBuilder } from './email.builder';

import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [EventEmitterModule], // 👈 explícito (buena práctica)
  providers: [EmailService, EmailListener, EmailBuilder],
  exports: [EmailService],
})
export class EmailModule {}

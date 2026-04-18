import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  DiscountUsed,
  DiscountUsedSchema,
} from './schemas/discount-used.schema';

import { DiscountsService } from './discounts.service.js';
import { DiscountsController } from './discounts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: DiscountUsed.name,
        schema: DiscountUsedSchema,
      },
    ]),
  ],
  controllers: [DiscountsController],
  providers: [DiscountsService],

  // ✅ IMPORTANTE: exportar el service para otros módulos (BookingModule)
  exports: [DiscountsService],
})
export class DiscountsModule {}

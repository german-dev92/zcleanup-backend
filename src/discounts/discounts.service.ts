import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { DiscountUsed } from './schemas/discount-used.schema';

@Injectable()
export class DiscountsService {
  constructor(
    @InjectModel(DiscountUsed.name)
    private discountModel: Model<DiscountUsed>,
  ) {}

  async hasUsedDiscount(email: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await this.discountModel.findOne({
      email: normalizedEmail,
    });

    return !!existing;
  }

  async markAsUsed(email: string, bookingId: string, session?: ClientSession) {
    const [created] = await this.discountModel.create(
      [
        {
          email,
          bookingId,
          usedAt: new Date(),
        },
      ],
      session ? { session } : undefined,
    );

    return created;
  }
}

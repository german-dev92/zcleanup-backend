import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { DiscountUsed } from './schemas/discount-used.schema';
import { normalizeAddress } from '../common/utils/normalize-address';

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

  async hasUsedDiscountByNormalizedAddress(
    normalizedAddress: string,
  ): Promise<boolean> {
    const existing = await this.discountModel.findOne({
      normalizedAddress,
    });

    return !!existing;
  }

  async hasUsedDiscountForAddress(address: string): Promise<boolean> {
    return this.hasUsedDiscountByNormalizedAddress(normalizeAddress(address));
  }

  async markAsUsed(email: string, bookingId: string, session?: ClientSession) {
    const normalizedEmail = email.toLowerCase().trim();

    const [created] = await this.discountModel.create(
      [
        {
          email: normalizedEmail,
          bookingId,
          usedAt: new Date(),
        },
      ],
      session ? { session } : undefined,
    );

    return created;
  }

  async markAddressAsUsed(
    params: {
      normalizedAddress: string;
      email?: string;
      bookingId: string;
    },
    session?: ClientSession,
  ) {
    const normalizedEmail =
      typeof params.email === 'string' ? params.email.toLowerCase().trim() : '';

    const [created] = await this.discountModel.create(
      [
        {
          email: normalizedEmail,
          normalizedAddress: params.normalizedAddress,
          bookingId: params.bookingId,
          usedAt: new Date(),
        },
      ],
      session ? { session } : undefined,
    );

    return created;
  }
}

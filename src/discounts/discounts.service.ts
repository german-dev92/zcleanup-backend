import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { DiscountUsed } from './schemas/discount-used.schema';
import { normalizeAddress } from '../common/utils/normalize-address';

@Injectable()
export class DiscountsService implements OnModuleInit {
  private readonly logger = new Logger(DiscountsService.name);

  constructor(
    @InjectModel(DiscountUsed.name)
    private discountModel: Model<DiscountUsed>,
  ) {}

  onModuleInit() {
    const nodeEnv =
      typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
    if (nodeEnv === 'production') {
      this.logger.warn(
        JSON.stringify({
          event: 'discount.index_migration_required',
          index: 'normalizedAddress_unique',
        }),
      );
    }
  }

  hasUsedDiscount(email: string): Promise<boolean> {
    const normalized = String(email ?? '')
      .toLowerCase()
      .trim();
    if (!normalized) return Promise.resolve(false);
    return this.discountModel
      .findOne({ email: normalized })
      .then((existing) => !!existing);
  }

  async hasUsedDiscountByNormalizedAddress(
    normalizedAddress: string,
  ): Promise<boolean> {
    const normalized = normalizeAddress(normalizedAddress);
    const existing = await this.discountModel.findOne({
      normalizedAddress: normalized,
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
      typeof params.email === 'string'
        ? params.email.toLowerCase().trim()
        : undefined;

    const normalizedAddress = normalizeAddress(params.normalizedAddress);

    try {
      const [created] = await this.discountModel.create(
        [
          {
            email: normalizedEmail,
            normalizedAddress,
            bookingId: params.bookingId,
            usedAt: new Date(),
          },
        ],
        session ? { session } : undefined,
      );

      return created;
    } catch (error) {
      if (this.isDuplicateKeyError(error) && this.isEmailDuplicateKey(error)) {
        const [created] = await this.discountModel.create(
          [
            {
              normalizedAddress,
              bookingId: params.bookingId,
              usedAt: new Date(),
            },
          ],
          session ? { session } : undefined,
        );

        return created;
      }

      throw error;
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
  }

  private isEmailDuplicateKey(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const keyPattern =
      'keyPattern' in error
        ? (error as { keyPattern?: unknown }).keyPattern
        : undefined;
    if (
      keyPattern &&
      typeof keyPattern === 'object' &&
      keyPattern !== null &&
      'email' in keyPattern
    ) {
      return true;
    }

    const message =
      'message' in error ? (error as { message?: unknown }).message : undefined;
    if (
      typeof message === 'string' &&
      message.toLowerCase().includes('email')
    ) {
      return true;
    }

    return false;
  }
}

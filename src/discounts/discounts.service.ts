import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { DiscountUsed } from './schemas/discount-used.schema';
import { normalizeAddress } from '../common/utils/normalize-address';

@Injectable()
export class DiscountsService implements OnModuleInit {
  constructor(
    @InjectModel(DiscountUsed.name)
    private discountModel: Model<DiscountUsed>,
  ) {}

  async onModuleInit() {
    try {
      const indexes = await this.discountModel.collection.indexes();
      const emailUniqueIndexes = indexes.filter(
        (index) => index?.unique === true && index?.key?.email === 1,
      );

      for (const index of emailUniqueIndexes) {
        if (typeof index?.name === 'string' && index.name) {
          await this.discountModel.collection.dropIndex(index.name);
        }
      }

      await this.discountModel.collection.createIndex(
        { normalizedAddress: 1 },
        { unique: true, sparse: true },
      );
    } catch (error) {
      console.log('[DISCOUNT INDEX]', 'index sync skipped', error);
    }
  }

  hasUsedDiscount(email: string): Promise<boolean> {
    void email;
    return Promise.resolve(false);
  }

  async hasUsedDiscountByNormalizedAddress(
    normalizedAddress: string,
  ): Promise<boolean> {
    const normalized = normalizeAddress(normalizedAddress);
    console.log('[DISCOUNT CHECK]', normalized);
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

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

  async onModuleInit() {
    const nodeEnv =
      typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
    const isProd = nodeEnv === 'production';

    try {
      const indexes = await this.discountModel.collection.indexes();

      const hasNormalizedAddressUnique = indexes.some((idx) => {
        const key = (idx as { key?: Record<string, unknown> }).key;
        const hasCorrectKey =
          !!key &&
          typeof key === 'object' &&
          'normalizedAddress' in key &&
          (key as Record<string, unknown>).normalizedAddress === 1;
        const isUnique = (idx as { unique?: boolean }).unique === true;
        const isSparse =
          (idx as { sparse?: boolean }).sparse === true || isUnique;
        return hasCorrectKey && isUnique && isSparse;
      });

      const hasEmailUnique = indexes.some((idx) => {
        const key = (idx as { key?: Record<string, unknown> }).key;
        const hasCorrectKey =
          !!key &&
          typeof key === 'object' &&
          'email' in key &&
          (key as Record<string, unknown>).email === 1;
        const isUnique = (idx as { unique?: boolean }).unique === true;
        const isSparse =
          (idx as { sparse?: boolean }).sparse === true || isUnique;
        return hasCorrectKey && isUnique && isSparse;
      });

      if (!hasNormalizedAddressUnique || !hasEmailUnique) {
        this.logger.warn(
          JSON.stringify({
            event: 'discount.index_migration_required',
            indexes: {
              normalizedAddress_unique: hasNormalizedAddressUnique
                ? 'ok'
                : 'missing_or_invalid',
              email_unique: hasEmailUnique ? 'ok' : 'missing_or_invalid',
            },
            remediation:
              'Run `npm run migrate:indexes` or set MONGO_ENSURE_INDEXES_ON_STARTUP=true once on next deploy. Both indexes must be unique+sparse.',
          }),
        );
      } else if (isProd) {
        this.logger.log(
          JSON.stringify({
            event: 'discount.indexes_verified',
            indexes: {
              normalizedAddress_unique: 'ok',
              email_unique: 'ok',
              bookingId_1: indexes.some((idx) => {
                const key = (idx as { key?: Record<string, unknown> }).key;
                return (
                  !!key &&
                  typeof key === 'object' &&
                  'bookingId' in key &&
                  (key as Record<string, unknown>).bookingId === 1
                );
              })
                ? 'ok'
                : 'absent',
            },
          }),
        );
      }
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'unknown';
      this.logger.warn(
        JSON.stringify({
          event: 'discount.index_check_skipped',
          reason: message,
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

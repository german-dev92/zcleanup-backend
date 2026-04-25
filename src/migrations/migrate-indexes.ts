import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { PaymentSchema } from '../payments/schemas/payment.schema';
import { DiscountUsedSchema } from '../discounts/schemas/discount-used.schema';
import { BookingSchema } from '../booking/schemas/booking.schema';

type IndexResult = {
  collection: string;
  index: string;
  action: 'created' | 'exists' | 'failed';
};

export async function migrateIndexes(): Promise<IndexResult[]> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to run this migration');
  }

  await mongoose.connect(mongoUri);

  const PaymentModel =
    mongoose.models.Payment ?? mongoose.model('Payment', PaymentSchema);
  const DiscountUsedModel =
    mongoose.models.DiscountUsed ??
    mongoose.model('DiscountUsed', DiscountUsedSchema);
  const BookingModel =
    mongoose.models.Booking ?? mongoose.model('Booking', BookingSchema);

  const results: IndexResult[] = [];

  try {
    results.push(
      ...(await ensureUniqueIndex({
        model: PaymentModel,
        collection: 'payments',
        keys: { bookingId: 1, provider: 1 },
        indexName: 'bookingId_1_provider_1_unique',
        options: { unique: true },
      })),
    );

    results.push(
      ...(await ensureUniqueIndex({
        model: DiscountUsedModel,
        collection: 'discountuseds',
        keys: { normalizedAddress: 1 },
        indexName: 'normalizedAddress_1_unique',
        options: { unique: true, sparse: true },
      })),
    );

    results.push(
      ...(await ensureIndex({
        model: BookingModel,
        collection: 'bookings',
        keys: { status: 1, createdAt: -1 },
        indexName: 'status_1_createdAt_-1',
        options: {},
      })),
    );
    results.push(
      ...(await ensureIndex({
        model: BookingModel,
        collection: 'bookings',
        keys: { email: 1, createdAt: -1 },
        indexName: 'email_1_createdAt_-1',
        options: {},
      })),
    );
    results.push(
      ...(await ensureIndex({
        model: BookingModel,
        collection: 'bookings',
        keys: { createdAt: -1 },
        indexName: 'createdAt_-1',
        options: {},
      })),
    );

    return results;
  } finally {
    await mongoose.disconnect();
  }
}

async function ensureUniqueIndex(params: {
  model: mongoose.Model<any>;
  collection: string;
  keys: Record<string, 1>;
  indexName: string;
  options: Record<string, unknown>;
}): Promise<IndexResult[]> {
  const { model, collection, keys, indexName, options } = params;

  try {
    const indexes = await model.collection.indexes();
    const exists = indexes.some((index) => {
      if (index?.unique !== true) return false;
      const key = index?.key as Record<string, unknown> | undefined;
      if (!key) return false;
      return Object.entries(keys).every(([k, v]) => key[k] === v);
    });

    if (exists) {
      return [{ collection, index: indexName, action: 'exists' as const }];
    }

    await model.collection.createIndex(keys, options);
    return [{ collection, index: indexName, action: 'created' as const }];
  } catch (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'unknown';
    process.stderr.write(
      `${JSON.stringify({
        level: 'warn',
        event: 'migrate.index_failed',
        collection,
        index: indexName,
        message,
      })}\n`,
    );
    return [{ collection, index: indexName, action: 'failed' as const }];
  }
}

async function ensureIndex(params: {
  model: mongoose.Model<any>;
  collection: string;
  keys: Record<string, 1 | -1>;
  indexName: string;
  options: Record<string, unknown>;
}): Promise<IndexResult[]> {
  const { model, collection, keys, indexName, options } = params;

  try {
    const indexes = await model.collection.indexes();
    const exists = indexes.some((index) => {
      const key = index?.key as Record<string, unknown> | undefined;
      if (!key) return false;
      return Object.entries(keys).every(([k, v]) => key[k] === v);
    });

    if (exists) {
      return [{ collection, index: indexName, action: 'exists' as const }];
    }

    await model.collection.createIndex(keys, options);
    return [{ collection, index: indexName, action: 'created' as const }];
  } catch (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'unknown';
    process.stderr.write(
      `${JSON.stringify({
        level: 'warn',
        event: 'migrate.index_failed',
        collection,
        index: indexName,
        message,
      })}\n`,
    );
    return [{ collection, index: indexName, action: 'failed' as const }];
  }
}

async function run() {
  const results = await migrateIndexes();
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (process.argv[1]?.includes('migrate-indexes')) {
  void run();
}

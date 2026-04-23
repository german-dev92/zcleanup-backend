import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { PaymentSchema } from '../payments/schemas/payment.schema';

export type PaymentIndexesMigrationResult = {
  created: string[];
  existing: string[];
};

export async function migratePaymentIndexes(): Promise<PaymentIndexesMigrationResult> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to run this migration');
  }

  await mongoose.connect(mongoUri);

  const PaymentModel =
    mongoose.models.Payment ?? mongoose.model('Payment', PaymentSchema);

  try {
    const existing = await PaymentModel.collection.indexes();
    const result: PaymentIndexesMigrationResult = { created: [], existing: [] };

    const hasBookingProviderUnique = existing.some(
      (index) =>
        index?.unique === true &&
        index?.key?.bookingId === 1 &&
        index?.key?.provider === 1,
    );

    if (hasBookingProviderUnique) {
      result.existing.push('bookingId_1_provider_1_unique');
    } else {
      await PaymentModel.collection.createIndex(
        { bookingId: 1, provider: 1 },
        { unique: true },
      );
      result.created.push('bookingId_1_provider_1_unique');
    }

    return result;
  } finally {
    await mongoose.disconnect();
  }
}

async function run() {
  const result = await migratePaymentIndexes();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]?.includes('migrate-payment-indexes')) {
  void run();
}

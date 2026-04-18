import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { BookingSchema } from '../booking/schemas/booking.schema';
import { DiscountUsedSchema } from '../discounts/schemas/discount-used.schema';
import { normalizeAddress } from '../common/utils/normalize-address';

type BookingAddressRecord = {
  address?: string;
};

type DiscountUsedCursorRecord = {
  _id: mongoose.Types.ObjectId;
  bookingId?: string;
};

export type DiscountUsedAddressMigrationResult = {
  scanned: number;
  updated: number;
  skippedNoBookingId: number;
  skippedBookingNotFound: number;
  skippedNoAddress: number;
  duplicateNormalizedAddress: number;
  errors: number;
};

export async function migrateDiscountUsedNormalizedAddress(): Promise<DiscountUsedAddressMigrationResult> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required to run this migration');
  }

  await mongoose.connect(mongoUri);

  const BookingModel =
    mongoose.models.Booking ?? mongoose.model('Booking', BookingSchema);
  const DiscountUsedModel =
    mongoose.models.DiscountUsed ??
    mongoose.model('DiscountUsed', DiscountUsedSchema);

  try {
    try {
      const indexes = await DiscountUsedModel.collection.indexes();
      const emailUniqueIndex = indexes.find(
        (index) => index.unique === true && index.key?.email === 1,
      );

      if (emailUniqueIndex?.name) {
        await DiscountUsedModel.collection.dropIndex(emailUniqueIndex.name);
      }
    } catch (error) {
      void error;
    }

    try {
      await DiscountUsedModel.collection.createIndex(
        { normalizedAddress: 1 },
        { unique: true, sparse: true },
      );
    } catch (error) {
      void error;
    }

    const result: DiscountUsedAddressMigrationResult = {
      scanned: 0,
      updated: 0,
      skippedNoBookingId: 0,
      skippedBookingNotFound: 0,
      skippedNoAddress: 0,
      duplicateNormalizedAddress: 0,
      errors: 0,
    };

    const cursor = DiscountUsedModel.find({
      $or: [
        { normalizedAddress: { $exists: false } },
        { normalizedAddress: null },
        { normalizedAddress: '' },
      ],
    })
      .select({ _id: 1, bookingId: 1 })
      .lean<DiscountUsedCursorRecord>()
      .cursor();

    for await (const doc of cursor) {
      result.scanned += 1;

      const bookingId = doc.bookingId;
      if (typeof bookingId !== 'string' || !bookingId.trim()) {
        result.skippedNoBookingId += 1;
        continue;
      }

      try {
        const booking = await BookingModel.findById(bookingId)
          .select({ address: 1 })
          .lean<BookingAddressRecord>();
        if (!booking) {
          result.skippedBookingNotFound += 1;
          continue;
        }
        const address = booking.address;
        if (typeof address !== 'string' || !address.trim()) {
          result.skippedNoAddress += 1;
          continue;
        }

        const normalizedAddress = normalizeAddress(address);
        if (!normalizedAddress) {
          result.skippedNoAddress += 1;
          continue;
        }

        await DiscountUsedModel.updateOne(
          { _id: doc._id },
          { $set: { normalizedAddress } },
        );
        result.updated += 1;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: unknown }).code === 11000
        ) {
          result.duplicateNormalizedAddress += 1;
          continue;
        }

        const isCastError =
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name?: unknown }).name === 'CastError';
        if (isCastError) {
          result.skippedBookingNotFound += 1;
          continue;
        }

        result.errors += 1;
      }
    }

    return result;
  } finally {
    await mongoose.disconnect();
  }
}

async function run() {
  const result = await migrateDiscountUsedNormalizedAddress();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1]?.includes('migrate-discount-used-normalized-address')) {
  void run();
}

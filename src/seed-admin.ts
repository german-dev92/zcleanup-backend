import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import { UserSchema } from './users/schemas/user.schema';
import { UserRole } from './auth/roles.enum';

type UserDoc = {
  email: string;
  passwordHash: string;
  role: UserRole;
};

type UserRecord = {
  _id: mongoose.Types.ObjectId;
  email: string;
  role: UserRole;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function run(): Promise<void> {
  const nodeEnv =
    typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
  if (nodeEnv === 'production') {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        action: 'aborted',
        reason: 'dev_only',
      })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const mongoUri = requireEnv('MONGO_URI');

  await mongoose.connect(mongoUri);

  const existingModel = mongoose.models.User as
    | mongoose.Model<UserDoc>
    | undefined;
  const UserModel =
    existingModel ?? mongoose.model<UserDoc>('User', UserSchema, 'users');

  try {
    const email = 'admin@zcleanup.com';
    const password = 'Admin123!';

    const saltRoundsRaw =
      typeof process.env.BCRYPT_SALT_ROUNDS === 'string'
        ? Number(process.env.BCRYPT_SALT_ROUNDS)
        : 12;
    const saltRounds = Number.isFinite(saltRoundsRaw) ? saltRoundsRaw : 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const existingUser = await UserModel.findOne({ email })
      .select({ _id: 1, email: 1, role: 1 })
      .lean<UserRecord>();

    if (existingUser && existingUser.role === UserRole.ADMIN) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          action: 'skipped',
          reason: 'admin_exists',
          adminEmail: existingUser.email,
        })}\n`,
      );
      return;
    }

    if (existingUser) {
      await UserModel.updateOne(
        { _id: existingUser._id },
        { $set: { role: UserRole.ADMIN, passwordHash } },
      );
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          action: 'updated',
          adminEmail: email,
        })}\n`,
      );
      return;
    }

    await UserModel.create({
      email,
      passwordHash,
      role: UserRole.ADMIN,
    });

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        action: 'created',
        adminEmail: email,
      })}\n`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

void run();

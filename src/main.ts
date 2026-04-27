import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  BadRequestException,
  Logger,
  NestInterceptor,
  ValidationPipe,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import type { ValidationError } from 'class-validator';
import { createClient } from 'redis';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  createRedisRateLimitMiddleware,
  type RateLimitRule,
} from './common/rate-limit/redis-rate-limiter';
import mongoose from 'mongoose';

type RequestWithId = Request & { requestId?: string };

type SanitizedValidationError = {
  property: string;
  constraints?: string[];
  children?: SanitizedValidationError[];
};

function sanitizeValidationErrors(
  errors: ValidationError[],
): SanitizedValidationError[] {
  return errors
    .map((e) => {
      const constraints = e.constraints
        ? Object.keys(e.constraints)
        : undefined;
      const children =
        Array.isArray(e.children) && e.children.length > 0
          ? sanitizeValidationErrors(e.children)
          : undefined;

      const out: SanitizedValidationError = { property: e.property };
      if (constraints && constraints.length > 0) out.constraints = constraints;
      if (children && children.length > 0) out.children = children;
      return out;
    })
    .filter((x) => x.property || x.constraints || x.children);
}

@Injectable()
class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = Date.now();
    const req = context.switchToHttp().getRequest<RequestWithId>();
    const res = context.switchToHttp().getResponse<Response>();

    const requestId =
      typeof req?.requestId === 'string' && req.requestId.trim()
        ? req.requestId
        : undefined;
    const method = typeof req?.method === 'string' ? req.method : 'UNKNOWN';
    const url = typeof req?.originalUrl === 'string' ? req.originalUrl : '/';

    return next.handle().pipe(
      tap(() => {
        const statusCode =
          typeof res?.statusCode === 'number' ? res.statusCode : 0;
        const durationMs = Date.now() - start;

        const isProd = process.env.NODE_ENV === 'production';
        const userValue = (req as unknown as { user?: unknown }).user;
        const actorSub =
          !isProd &&
          typeof userValue === 'object' &&
          userValue !== null &&
          typeof (userValue as { sub?: unknown }).sub === 'string'
            ? String((userValue as { sub?: unknown }).sub)
            : undefined;
        const actorRole =
          !isProd &&
          typeof userValue === 'object' &&
          userValue !== null &&
          typeof (userValue as { role?: unknown }).role === 'string'
            ? String((userValue as { role?: unknown }).role)
            : undefined;

        this.logger.log(
          JSON.stringify({
            requestId,
            method,
            url,
            statusCode,
            durationMs,
            actorSub,
            actorRole,
          }),
        );
      }),
      catchError((error: unknown) => {
        const statusCode =
          typeof (error as { status?: unknown })?.status === 'number'
            ? ((error as { status?: unknown }).status as number)
            : typeof res?.statusCode === 'number'
              ? res.statusCode
              : 500;
        const durationMs = Date.now() - start;

        const isProd = process.env.NODE_ENV === 'production';
        const userValue = (req as unknown as { user?: unknown }).user;
        const actorSub =
          !isProd &&
          typeof userValue === 'object' &&
          userValue !== null &&
          typeof (userValue as { sub?: unknown }).sub === 'string'
            ? String((userValue as { sub?: unknown }).sub)
            : undefined;
        const actorRole =
          !isProd &&
          typeof userValue === 'object' &&
          userValue !== null &&
          typeof (userValue as { role?: unknown }).role === 'string'
            ? String((userValue as { role?: unknown }).role)
            : undefined;

        this.logger.error(
          JSON.stringify({
            requestId,
            method,
            url,
            statusCode,
            durationMs,
            actorSub,
            actorRole,
          }),
        );

        if (process.env.ERROR_TRACKING_ENABLED === 'true') {
          void error;
        }

        return throwError(() => error);
      }),
    );
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toSafeErrorLog(value: unknown): {
  name?: string;
  message?: string;
  code?: string;
} {
  if (value instanceof Error) {
    const anyErr = value as unknown as { code?: unknown };
    return {
      name: value.name,
      message: value.message,
      code: typeof anyErr.code === 'string' ? anyErr.code : undefined,
    };
  }
  if (typeof value === 'object' && value !== null) {
    const anyObj = value as Record<string, unknown>;
    const name = typeof anyObj.name === 'string' ? anyObj.name : undefined;
    const message =
      typeof anyObj.message === 'string' ? anyObj.message : undefined;
    const code = typeof anyObj.code === 'string' ? anyObj.code : undefined;
    if (name || message || code) {
      return { name, message, code };
    }
  }
  return { message: typeof value === 'string' ? value : undefined };
}

function validateEnvForStartup(): void {
  requireEnv('MONGO_URI');

  const nodeEnv =
    typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
  const isProd = nodeEnv === 'production';
  if (!isProd) {
    return;
  }

  requireEnv('FRONTEND_URL');
  if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
    new Logger('bootstrap').error(
      JSON.stringify({ event: 'config.missing_jwt_secret' }),
    );
    process.exit(1);
  }
  const stripeSecretKey = requireEnv('STRIPE_SECRET_KEY');
  const stripeWebhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');
  if (!stripeSecretKey.startsWith('sk_')) {
    new Logger('bootstrap').error(
      JSON.stringify({ event: 'config.invalid_stripe_secret_key_format' }),
    );
    process.exit(1);
  }
  if (!stripeWebhookSecret.startsWith('whsec_')) {
    new Logger('bootstrap').error(
      JSON.stringify({ event: 'config.invalid_stripe_webhook_secret_format' }),
    );
    process.exit(1);
  }
  const trustProxyEnv =
    typeof process.env.TRUST_PROXY === 'string' ? process.env.TRUST_PROXY : '';
  if (!trustProxyEnv.trim()) {
    new Logger('bootstrap').warn(
      JSON.stringify({ event: 'config.trust_proxy_unset' }),
    );
  }
  requireEnv('EMAIL_USER');
  requireEnv('EMAIL_PASS');
}

async function bootstrap() {
  validateEnvForStartup();

  const nodeEnv =
    typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
  const isProd = nodeEnv === 'production';

  const bootstrapLogger = new Logger('bootstrap');
  const primaryGeoKey =
    typeof process.env.GOOGLE_MAPS_SERVER_API_KEY === 'string'
      ? process.env.GOOGLE_MAPS_SERVER_API_KEY.trim()
      : '';
  const fallbackGeoKeyMaps =
    typeof process.env.GOOGLE_MAPS_API_KEY === 'string'
      ? process.env.GOOGLE_MAPS_API_KEY.trim()
      : '';
  const fallbackGeoKeyGoogle =
    typeof process.env.GOOGLE_API_KEY === 'string'
      ? process.env.GOOGLE_API_KEY.trim()
      : '';

  const hasKey = !!(
    primaryGeoKey ||
    fallbackGeoKeyMaps ||
    fallbackGeoKeyGoogle
  );
  const usingFallback =
    !primaryGeoKey && !!(fallbackGeoKeyMaps || fallbackGeoKeyGoogle);
  const keySource = primaryGeoKey
    ? 'primary'
    : fallbackGeoKeyMaps
      ? 'fallback_google_maps_api_key'
      : fallbackGeoKeyGoogle
        ? 'fallback_google_api_key'
        : 'none';

  bootstrapLogger.log(
    JSON.stringify({
      event: 'geo.config_check',
      hasKey,
      usingFallback,
      keySource,
    }),
  );
  if (!hasKey) {
    bootstrapLogger.error(JSON.stringify({ event: 'geo.config_missing' }));
    process.env.GEO_PRICING_GEOCODING_STATUS = 'degraded';
  } else if (usingFallback) {
    bootstrapLogger.warn(
      JSON.stringify({
        event: 'geo.config_fallback_used',
        keySource,
      }),
    );
    process.env.GEO_PRICING_GEOCODING_STATUS = 'degraded';
  } else {
    process.env.GEO_PRICING_GEOCODING_STATUS = 'ok';
  }
  process.on('unhandledRejection', (reason: unknown) => {
    bootstrapLogger.error(
      JSON.stringify({
        event: 'process.unhandled_rejection',
        reason: toSafeErrorLog(reason),
      }),
    );
    if (isProd) {
      process.exit(1);
    }
  });
  process.on('uncaughtException', (error: unknown) => {
    bootstrapLogger.error(
      JSON.stringify({
        event: 'process.uncaught_exception',
        error: toSafeErrorLog(error),
      }),
    );
    if (isProd) {
      process.exit(1);
    }
  });

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: isProd
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug'],
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const headerValue = req.headers['x-request-id'];
    const headerId =
      typeof headerValue === 'string' ? headerValue.trim() : undefined;
    const requestId = headerId && headerId.length > 0 ? headerId : randomUUID();
    (req as RequestWithId).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });

  const trustProxyRaw =
    typeof process.env.TRUST_PROXY === 'string' ? process.env.TRUST_PROXY : '';
  const trustProxyTrimmed = trustProxyRaw.trim();
  if (trustProxyTrimmed && trustProxyTrimmed !== 'false') {
    const parsed = Number(trustProxyTrimmed);
    const value =
      trustProxyTrimmed === 'true'
        ? 1
        : Number.isFinite(parsed)
          ? Math.max(0, Math.trunc(parsed))
          : trustProxyTrimmed;
    (app as unknown as { set: (key: string, value: unknown) => void }).set(
      'trust proxy',
      value,
    );
  }

  const bookingRateLimitWindowMs = Number(
    process.env.BOOKING_RATE_WINDOW_MS ?? 900_000,
  );
  const bookingRateLimitMax = Number(process.env.BOOKING_RATE_MAX ?? 15);

  const pricePreviewRateLimitWindowMs = Number(
    process.env.PRICE_PREVIEW_RATE_WINDOW_MS ?? 900_000,
  );
  const pricePreviewRateLimitMax = Number(
    process.env.PRICE_PREVIEW_RATE_MAX ?? 50,
  );

  const authRateLimitWindowMs = Number(
    process.env.AUTH_RATE_WINDOW_MS ?? 60_000,
  );
  const authRateLimitMax = Number(process.env.AUTH_RATE_MAX ?? 10);

  const rules: RateLimitRule[] = [
    {
      method: 'POST',
      path: '/booking',
      windowMs: bookingRateLimitWindowMs,
      max: bookingRateLimitMax,
      keyPrefix: 'rl:booking',
      message: 'Too many booking requests. Please try again later.',
    },
    {
      method: 'POST',
      path: '/booking/price-preview',
      windowMs: pricePreviewRateLimitWindowMs,
      max: pricePreviewRateLimitMax,
      keyPrefix: 'rl:price_preview',
      message: 'Too many price preview requests. Please try again later.',
    },
    {
      method: 'POST',
      path: '/auth/login',
      windowMs: authRateLimitWindowMs,
      max: authRateLimitMax,
      keyPrefix: 'rl:auth_login',
      message: 'Too many login attempts. Please try again later.',
    },
  ].filter((r) => Number.isFinite(r.windowMs) && r.windowMs > 0 && r.max > 0);

  const redisUrl =
    typeof process.env.REDIS_URL === 'string'
      ? process.env.REDIS_URL.trim()
      : '';
  const shouldUseRedisRateLimit = rules.length > 0;

  if (isProd && shouldUseRedisRateLimit && !redisUrl) {
    bootstrapLogger.error(
      JSON.stringify({ event: 'config.missing_redis_url' }),
    );
    process.exit(1);
  }

  if (redisUrl && shouldUseRedisRateLimit) {
    const redis = createClient({ url: redisUrl });
    redis.on('error', (err) => {
      bootstrapLogger.error(
        JSON.stringify({ event: 'redis.error', error: toSafeErrorLog(err) }),
      );
    });
    await redis.connect();

    const middleware = createRedisRateLimitMiddleware({
      client: redis,
      rules,
      onError: (err) => {
        bootstrapLogger.error(
          JSON.stringify({
            event: 'rate_limit.redis_error',
            error: toSafeErrorLog(err),
          }),
        );
      },
    });
    app.use(middleware);

    const shutdown = async () => {
      try {
        await redis.quit();
      } catch {
        await redis.disconnect();
      }
    };
    process.on('SIGINT', () => {
      void shutdown();
    });
    process.on('SIGTERM', () => {
      void shutdown();
    });
  }

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4200';

  const normalizeOriginValue = (value: string): string => {
    const trimmed = String(value ?? '')
      .trim()
      .replace(/^['"`]+|['"`]+$/g, '');
    if (!trimmed) return '';
    try {
      return new URL(trimmed).origin.toLowerCase();
    } catch {
      return trimmed.replace(/\/$/, '').toLowerCase();
    }
  };

  const baseAllowedOrigins = frontendUrl
    .split(',')
    .map((v) => normalizeOriginValue(v))
    .filter(Boolean);

  const allowedOrigins = isProd
    ? Array.from(new Set(baseAllowedOrigins))
    : Array.from(
        new Set([
          ...baseAllowedOrigins,
          'http://localhost:4200',
          'http://127.0.0.1:4200',
        ]),
      );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);

      const normalizedOrigin = normalizeOriginValue(origin);

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },

    // 🔥 FIX CLAVE: incluir PATCH
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: ['Content-Type', 'Authorization'],

    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        return new BadRequestException({
          message: 'Validation failed',
          errors: sanitizeValidationErrors(errors),
        });
      },
    }),
  );

  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  const swaggerEnabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    process.env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('ZCleanUp API')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const ensureIndexesRaw =
    typeof process.env.MONGO_ENSURE_INDEXES_ON_STARTUP === 'string'
      ? process.env.MONGO_ENSURE_INDEXES_ON_STARTUP
      : '';
  const ensureIndexesTrimmed = ensureIndexesRaw.trim().toLowerCase();
  const ensureIndexesRequested = ensureIndexesTrimmed === 'true';
  const ensureIndexesEnabled = ensureIndexesRequested || !isProd;

  if (ensureIndexesEnabled) {
    const modelNames = ['Booking', 'DiscountUsed', 'Payment'];
    try {
      const asPromise =
        typeof (mongoose.connection as unknown as { asPromise?: unknown })
          .asPromise === 'function'
          ? (
              mongoose.connection as unknown as {
                asPromise: () => Promise<unknown>;
              }
            ).asPromise
          : null;
      if (asPromise) {
        await asPromise();
      }

      const results = await Promise.allSettled(
        modelNames.map(async (name) => {
          const model = mongoose.models[name];
          if (!model) return { name, action: 'skipped' as const };
          await model.createIndexes();
          return { name, action: 'ok' as const };
        }),
      );

      bootstrapLogger.log(
        JSON.stringify({
          event: 'mongo.indexes_ensured',
          results: results.map((r) =>
            r.status === 'fulfilled'
              ? r.value
              : { action: 'failed', reason: 'rejected' },
          ),
        }),
      );

      if (
        ensureIndexesRequested &&
        results.some((r) => r.status === 'rejected')
      ) {
        process.exit(1);
      }
    } catch (error) {
      bootstrapLogger.error(
        JSON.stringify({
          event: 'mongo.indexes_failed',
          error: toSafeErrorLog(error),
        }),
      );
      if (ensureIndexesRequested) {
        process.exit(1);
      }
    }
  }

  const portRaw = process.env.PORT ?? 3000;
  await app.listen(portRaw);
  bootstrapLogger.log(
    JSON.stringify({ event: 'server.listening', port: String(portRaw) }),
  );
}

void bootstrap().catch((error: unknown) => {
  const bootstrapLogger = new Logger('bootstrap');
  bootstrapLogger.error(
    JSON.stringify({
      event: 'bootstrap.rejected',
      error: toSafeErrorLog(error),
    }),
  );
  process.exit(1);
});

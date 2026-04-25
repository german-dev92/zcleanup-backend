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
  requireEnv('STRIPE_SECRET_KEY');
  requireEnv('STRIPE_WEBHOOK_SECRET');
  requireEnv('EMAIL_USER');
  requireEnv('EMAIL_PASS');
}

async function bootstrap() {
  validateEnvForStartup();

  const nodeEnv =
    typeof process.env.NODE_ENV === 'string' ? process.env.NODE_ENV : '';
  const isProd = nodeEnv === 'production';

  const bootstrapLogger = new Logger('bootstrap');
  process.on('unhandledRejection', (reason: unknown) => {
    bootstrapLogger.error(
      JSON.stringify({ event: 'process.unhandled_rejection' }),
    );
    void reason;
  });
  process.on('uncaughtException', (error: unknown) => {
    bootstrapLogger.error(
      JSON.stringify({ event: 'process.uncaught_exception' }),
    );
    void error;
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

  const bookingRateLimitWindowMs = Number(
    process.env.BOOKING_RATE_WINDOW_MS ?? 60_000,
  );
  const bookingRateLimitMax = Number(process.env.BOOKING_RATE_MAX ?? 20);
  const bookingRateLimitEnabled =
    bookingRateLimitWindowMs > 0 && bookingRateLimitMax > 0;
  const bookingRateState = new Map<
    string,
    { count: number; resetAt: number }
  >();

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!bookingRateLimitEnabled) return next();
    if (req.method !== 'POST') return next();
    const path = typeof req.path === 'string' ? req.path : '';
    if (path !== '/booking') return next();

    const requestId =
      typeof (req as RequestWithId).requestId === 'string' &&
      (req as RequestWithId).requestId?.trim()
        ? (req as RequestWithId).requestId
        : undefined;

    const forwardedFor = req.headers['x-forwarded-for'];
    const rawForwarded =
      typeof forwardedFor === 'string'
        ? forwardedFor
        : Array.isArray(forwardedFor)
          ? forwardedFor.join(',')
          : '';
    const forwardedIp = rawForwarded.split(',')[0]?.trim();
    const socketInfo = req.socket as unknown as { remoteAddress?: unknown };
    const socketRemoteAddress =
      typeof socketInfo?.remoteAddress === 'string'
        ? socketInfo.remoteAddress
        : undefined;
    const ip = forwardedIp || req.ip || socketRemoteAddress || 'unknown';

    const now = Date.now();
    if (bookingRateState.size > 20000) {
      let scanned = 0;
      for (const [key, value] of bookingRateState) {
        if (value.resetAt <= now) {
          bookingRateState.delete(key);
        }
        scanned += 1;
        if (scanned >= 500) break;
      }
    }
    const current = bookingRateState.get(ip);
    if (!current || current.resetAt <= now) {
      bookingRateState.set(ip, {
        count: 1,
        resetAt: now + bookingRateLimitWindowMs,
      });
      return next();
    }

    current.count += 1;
    if (current.count <= bookingRateLimitMax) {
      bookingRateState.set(ip, current);
      return next();
    }

    res.setHeader(
      'Retry-After',
      String(Math.ceil((current.resetAt - now) / 1000)),
    );
    res.status(429).json({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many booking requests. Please try again later.',
      requestId,
    });
  });

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:4200';

  const allowedOrigins = frontendUrl
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.replace(/\/$/, ''));

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/$/, '');

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

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();

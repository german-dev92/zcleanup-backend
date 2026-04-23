import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  ValidationPipe,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

type RequestWithId = Request & { requestId?: string };

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
        this.logger.log(
          JSON.stringify({
            requestId,
            method,
            url,
            statusCode,
            durationMs,
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
        this.logger.error(
          JSON.stringify({
            requestId,
            method,
            url,
            statusCode,
            durationMs,
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
    }),
  );

  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();

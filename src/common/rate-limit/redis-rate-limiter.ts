import type { NextFunction, Request, Response } from 'express';
import type { RedisClientType } from 'redis';

export type RateLimitRule = {
  method: string;
  path: string;
  windowMs: number;
  max: number;
  keyPrefix: string;
  message: string;
};

const RATE_LIMIT_LUA = [
  'local current = redis.call("INCR", KEYS[1])',
  'if current == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
  'local ttl = redis.call("PTTL", KEYS[1])',
  'return {current, ttl}',
].join('\n');

export function getRequestIp(req: Request): string {
  const socketInfo = req.socket as unknown as { remoteAddress?: unknown };
  const socketRemoteAddress =
    typeof socketInfo?.remoteAddress === 'string'
      ? socketInfo.remoteAddress
      : '';
  const expressIp = typeof req.ip === 'string' ? req.ip : '';
  const ip = (expressIp || socketRemoteAddress || 'unknown').trim();
  return ip || 'unknown';
}

export async function redisIncrementWithTtl(params: {
  client: Pick<RedisClientType, 'eval'>;
  key: string;
  windowMs: number;
}): Promise<{ count: number; ttlMs: number }> {
  const { client, key, windowMs } = params;
  const windowArg = String(Math.max(1, Math.trunc(windowMs)));

  const res = await client.eval(RATE_LIMIT_LUA, {
    keys: [key],
    arguments: [windowArg],
  });

  if (!Array.isArray(res) || res.length < 2) {
    throw new Error('Unexpected Redis EVAL response');
  }

  const countRaw = res[0];
  const ttlRaw = res[1];

  const count =
    typeof countRaw === 'number'
      ? countRaw
      : typeof countRaw === 'string'
        ? Number(countRaw)
        : NaN;
  const ttlMs =
    typeof ttlRaw === 'number'
      ? ttlRaw
      : typeof ttlRaw === 'string'
        ? Number(ttlRaw)
        : NaN;

  if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
    throw new Error('Unexpected Redis EVAL response');
  }

  return { count, ttlMs };
}

export function createRedisRateLimitMiddleware(params: {
  client: Pick<RedisClientType, 'eval'>;
  rules: RateLimitRule[];
  onError?: (err: unknown) => void;
}) {
  const { client, rules, onError } = params;

  return async (req: Request, res: Response, next: NextFunction) => {
    const method = typeof req.method === 'string' ? req.method : '';
    const path = typeof req.path === 'string' ? req.path : '';

    const rule = rules.find((r) => r.method === method && r.path === path);
    if (!rule) return next();
    if (rule.windowMs <= 0 || rule.max <= 0) return next();

    const ip = getRequestIp(req);
    const key = `${rule.keyPrefix}:${ip}`;

    try {
      const { count, ttlMs } = await redisIncrementWithTtl({
        client,
        key,
        windowMs: rule.windowMs,
      });

      res.setHeader('X-RateLimit-Limit', String(rule.max));
      res.setHeader(
        'X-RateLimit-Remaining',
        String(Math.max(0, rule.max - count)),
      );
      res.setHeader(
        'X-RateLimit-Reset',
        String(Date.now() + Math.max(0, ttlMs)),
      );

      if (count <= rule.max) {
        return next();
      }

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(Math.max(0, ttlMs) / 1000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));

      const requestId =
        typeof (req as unknown as { requestId?: unknown }).requestId ===
        'string'
          ? String((req as unknown as { requestId?: unknown }).requestId)
          : undefined;

      res.status(429).json({
        statusCode: 429,
        error: 'Too Many Requests',
        message: rule.message,
        requestId,
      });
      return;
    } catch (err) {
      if (onError) onError(err);
      return next();
    }
  };
}

import { createRedisRateLimitMiddleware } from './redis-rate-limiter';
import type { Request, Response } from 'express';

describe('createRedisRateLimitMiddleware', () => {
  it('enforces limits for matching routes using Redis eval', async () => {
    const state = new Map<string, { count: number; expiresAt: number }>();

    type EvalOptions = { keys: string[]; arguments: string[] };
    type EvalReturn = [number, number];
    type MockRedisClient = {
      eval: (script: string, opts: EvalOptions) => Promise<EvalReturn>;
    };

    const evalImpl: MockRedisClient['eval'] = (_script, opts) => {
      const key = String(opts.keys[0] ?? '');
      const windowMs = Number(opts.arguments[0] ?? 0);
      const now = Date.now();

      const current = state.get(key);
      if (!current || current.expiresAt <= now) {
        const expiresAt = now + windowMs;
        state.set(key, { count: 1, expiresAt });
        return Promise.resolve([1, expiresAt - now]);
      }

      current.count += 1;
      state.set(key, current);
      return Promise.resolve([
        current.count,
        Math.max(0, current.expiresAt - now),
      ]);
    };

    const client: MockRedisClient = {
      eval: jest.fn(evalImpl),
    };

    const middleware = createRedisRateLimitMiddleware({
      client,
      rules: [
        {
          method: 'POST',
          path: '/booking',
          windowMs: 60_000,
          max: 2,
          keyPrefix: 'rl:booking',
          message: 'Too many booking requests. Please try again later.',
        },
      ],
    });

    const next = jest.fn<void, []>();

    type MockReq = {
      method: string;
      path: string;
      ip?: string;
      socket: { remoteAddress?: string };
      requestId?: string;
    };

    type MockRes = {
      headers: Record<string, string>;
      statusCode: number;
      body?: unknown;
      setHeader: (k: string, v: string) => void;
      status: (code: number) => MockRes;
      json: (payload: unknown) => MockRes;
    };

    const mkReq = (): MockReq => ({
      method: 'POST',
      path: '/booking',
      ip: '203.0.113.10',
      socket: { remoteAddress: '203.0.113.10' },
      requestId: 'req-1',
    });

    const mkRes = (): MockRes => {
      const res: MockRes = {
        headers: {},
        statusCode: 200,
        setHeader: (k, v) => {
          res.headers[k] = v;
        },
        status: (code) => {
          res.statusCode = code;
          return res;
        },
        json: (payload) => {
          res.body = payload;
          return res;
        },
      };
      return res;
    };

    const res1 = mkRes();
    await middleware(
      mkReq() as unknown as Request,
      res1 as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res1.statusCode).toBe(200);

    const res2 = mkRes();
    await middleware(
      mkReq() as unknown as Request,
      res2 as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(2);
    expect(res2.statusCode).toBe(200);

    const res3 = mkRes();
    await middleware(
      mkReq() as unknown as Request,
      res3 as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(2);
    expect(res3.statusCode).toBe(429);
    expect(res3.body).toEqual(
      expect.objectContaining({
        statusCode: 429,
        error: 'Too Many Requests',
      }),
    );
    expect(client.eval).toHaveBeenCalled();
  });

  it('ignores non-matching routes', async () => {
    const client = { eval: jest.fn(() => Promise.resolve([1, 0] as const)) };
    const middleware = createRedisRateLimitMiddleware({
      client,
      rules: [
        {
          method: 'POST',
          path: '/booking',
          windowMs: 60_000,
          max: 1,
          keyPrefix: 'rl:booking',
          message: 'Too many booking requests. Please try again later.',
        },
      ],
    });

    const req = {
      method: 'GET',
      path: '/booking',
      ip: '203.0.113.10',
      socket: { remoteAddress: '203.0.113.10' },
    };
    const res = { setHeader: jest.fn<void, [string, string]>() };
    const next = jest.fn<void, []>();
    await middleware(
      req as unknown as Request,
      res as unknown as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(client.eval).not.toHaveBeenCalled();
  });
});

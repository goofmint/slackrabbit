import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import { checkBearer, timingSafeEqual } from './auth';
import worker from './index';

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const kv = {
  get: async () => null,
  put: async () => undefined,
} as unknown as KVNamespace;

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SLACK_CACHE: kv,
    SLACK_XOXB_TOKEN: 'xoxb-test',
    MCP_API_KEY: 'secret-key',
    ...overrides,
  };
}

function toolsListRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://worker.example/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
}

describe('timingSafeEqual', () => {
  it('returns true for equal strings and false otherwise', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
  });
});

describe('checkBearer', () => {
  it('skips auth when no key is configured', () => {
    expect(checkBearer(new Request('https://x/'), undefined)).toBe(true);
  });

  it('requires the Bearer scheme (case-insensitive) and an exact token', () => {
    const req = (auth?: string) =>
      new Request('https://x/', { headers: auth ? { Authorization: auth } : {} });
    expect(checkBearer(req(), 'k')).toBe(false);
    expect(checkBearer(req('k'), 'k')).toBe(false); // bare key, no scheme
    expect(checkBearer(req('Bearer nope'), 'k')).toBe(false);
    expect(checkBearer(req('Bearer k'), 'k')).toBe(true);
    expect(checkBearer(req('bearer k'), 'k')).toBe(true);
  });
});

describe('worker.fetch', () => {
  it('returns 401 without Authorization when MCP_API_KEY is set', async () => {
    const res = await worker.fetch(toolsListRequest(), makeEnv(), ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('returns 401 for a wrong token', async () => {
    const res = await worker.fetch(
      toolsListRequest({ Authorization: 'Bearer wrong' }),
      makeEnv(),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it('serves /mcp for the correct token', async () => {
    const res = await worker.fetch(
      toolsListRequest({ Authorization: 'Bearer secret-key' }),
      makeEnv(),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it('serves /mcp without auth when MCP_API_KEY is unset', async () => {
    const res = await worker.fetch(toolsListRequest(), makeEnv({ MCP_API_KEY: undefined }), ctx);
    expect(res.status).toBe(200);
  });

  it('returns 500 with the reason when configuration is invalid', async () => {
    const res = await worker.fetch(
      toolsListRequest({ Authorization: 'Bearer secret-key' }),
      makeEnv({ SLACK_XOXB_TOKEN: undefined }),
      ctx,
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('SLACK_XOXP_TOKEN or SLACK_XOXB_TOKEN must be set');
  });
});

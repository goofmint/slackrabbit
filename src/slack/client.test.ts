import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';
import { SlackClient } from './client';

/** Builds a minimal {@link Config} for tests, with overridable fields. */
function makeCfg(overrides: Partial<Config> = {}): Config {
  return {
    xoxp: 'xoxp-user-token',
    xoxb: 'xoxb-bot-token',
    mcpApiKey: undefined,
    addMessagePolicy: { kind: 'disabled' },
    readToken: 'xoxp-user-token',
    postToken: 'xoxb-bot-token',
    searchEnabled: true,
    ...overrides,
  };
}

/** Builds a fake `Response`-like object for a mocked `fetchImpl`. */
function makeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headerMap = new Map(Object.entries(headers));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headerMap.get(name) ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

describe('SlackClient', () => {
  it('builds correct GET URL/query and Authorization header for conversationsList using readToken', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { ok: true, channels: [] }),
    );
    const cfg = makeCfg({ readToken: 'xoxb-read-token' });
    const client = new SlackClient(cfg, { fetchImpl });

    await client.conversationsList({ types: 'public_channel', limit: 50, cursor: 'abc' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://slack.com/api/conversations.list');
    expect(parsed.searchParams.get('types')).toBe('public_channel');
    expect(parsed.searchParams.get('limit')).toBe('50');
    expect(parsed.searchParams.get('cursor')).toBe('abc');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer xoxb-read-token',
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('skips undefined params and stringifies booleans/numbers in the query string', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { ok: true, channels: [] }),
    );
    const client = new SlackClient(makeCfg(), { fetchImpl });

    await client.conversationsList({ exclude_archived: true });

    const [url] = fetchImpl.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('exclude_archived')).toBe('true');
    expect(parsed.searchParams.has('types')).toBe(false);
    expect(parsed.searchParams.has('cursor')).toBe(false);
  });

  it('postMessage uses postToken, POST method, JSON body, and correct Content-Type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { ok: true, channel: 'C123', ts: '123.456' }),
    );
    const cfg = makeCfg({ postToken: 'xoxb-post-token' });
    const client = new SlackClient(cfg, { fetchImpl });

    const result = await client.postMessage({ channel: 'C123', text: 'hello' });

    expect(result).toEqual({ channel: 'C123', ts: '123.456' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer xoxb-post-token',
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C123', text: 'hello' });
  });

  it('searchMessages uses xoxp token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { ok: true, messages: { matches: [] } }),
    );
    const cfg = makeCfg({ xoxp: 'xoxp-search-token' });
    const client = new SlackClient(cfg, { fetchImpl });

    await client.searchMessages({ query: 'hello' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer xoxp-search-token',
    );
  });

  it('searchMessages throws before fetch when xoxp is missing', async () => {
    const fetchImpl = vi.fn();
    const cfg = makeCfg({ xoxp: undefined });
    const client = new SlackClient(cfg, { fetchImpl });

    await expect(client.searchMessages({ query: 'hello' })).rejects.toThrow(
      'search.messages requires a user token (SLACK_XOXP_TOKEN)',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws an error containing the Slack error code when ok is false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse(200, { ok: false, error: 'channel_not_found' }),
    );
    const client = new SlackClient(makeCfg(), { fetchImpl });

    await expect(
      client.conversationsHistory({ channel: 'C_MISSING' }),
    ).rejects.toThrow(/channel_not_found/);
  });

  it('retries once after a 429 with Retry-After, sleeping the given number of seconds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true, channels: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new SlackClient(makeCfg(), { fetchImpl, sleep });

    const result = await client.conversationsList();

    expect(result).toEqual({ channels: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('defaults to a 1-second sleep when Retry-After is missing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, {}))
      .mockResolvedValueOnce(makeResponse(200, { ok: true, channels: [] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new SlackClient(makeCfg(), { fetchImpl, sleep });

    await client.conversationsList();

    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('throws after repeated 429s (3 attempts total, 2 retries)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, {}, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(makeResponse(429, {}, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(makeResponse(429, {}, { 'Retry-After': '0' }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new SlackClient(makeCfg(), { fetchImpl, sleep });

    await expect(client.conversationsList()).rejects.toThrow(
      /Slack API conversations\.list rate limited/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws with the HTTP status for non-2xx, non-429 responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(500, {}));
    const client = new SlackClient(makeCfg(), { fetchImpl });

    await expect(client.conversationsList()).rejects.toThrow(
      /Slack API conversations\.list failed: HTTP 500/,
    );
  });
});

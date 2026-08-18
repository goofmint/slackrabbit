import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL_SECONDS,
  CHANNELS_CACHE_KEY,
  USERS_CACHE_KEY,
  type CacheClient,
  getChannels,
  getUsers,
  resolveChannelId,
} from './cache.js';
import type { SlackChannel, SlackUser } from './types.js';

type PutCall = { key: string; value: string; options?: { expirationTtl?: number } };

/** Minimal in-memory fake of the KVNamespace surface the cache layer uses. */
function createFakeKv() {
  const store = new Map<string, string>();
  const putCalls: PutCall[] = [];

  const kv = {
    async get(key: string, _type: 'json') {
      const raw = store.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, value);
      putCalls.push({ key, value, options });
    },
  };

  return { kv: kv as unknown as KVNamespace, store, putCalls };
}

const alice: SlackUser = { id: 'U1', name: 'alice', real_name: 'Alice' };
const bob: SlackUser = { id: 'U2', name: 'bob', real_name: 'Bob' };
const gone: SlackUser = { id: 'U3', name: 'ghost', deleted: true };

const general: SlackChannel = { id: 'C1', name: 'general' };
const random: SlackChannel = { id: 'C2', name: 'random' };
const dmWithAlice: SlackChannel = { id: 'D1', is_im: true, user: 'U1' };

/** Fake CacheClient with call counters and simple two-page pagination for users. */
function createFakeClient(): CacheClient & { usersListCalls: number; conversationsListCalls: number } {
  const counters = { usersListCalls: 0, conversationsListCalls: 0 };

  const client = {
    async usersList(params?: { limit?: number; cursor?: string }) {
      counters.usersListCalls++;
      client.usersListCalls = counters.usersListCalls;
      if (!params?.cursor) {
        return { members: [alice], response_metadata: { next_cursor: 'page2' } };
      }
      return { members: [bob, gone], response_metadata: { next_cursor: '' } };
    },
    async conversationsList(_params?: {
      types?: string;
      limit?: number;
      cursor?: string;
      exclude_archived?: boolean;
    }) {
      counters.conversationsListCalls++;
      client.conversationsListCalls = counters.conversationsListCalls;
      return {
        channels: [general, random, dmWithAlice],
        response_metadata: { next_cursor: '' },
      };
    },
    usersListCalls: 0,
    conversationsListCalls: 0,
  };

  return client;
}

describe('getUsers', () => {
  it('fetches and paginates on a KV miss, then writes back with a 24h TTL', async () => {
    const { kv, putCalls } = createFakeKv();
    const client = createFakeClient();

    const cache = await getUsers(kv, client);

    expect(client.usersListCalls).toBe(2);
    expect(cache.byId).toEqual({ U1: alice, U2: bob, U3: gone });
    expect(cache.byName).toEqual({ '@alice': 'U1', '@bob': 'U2' });
    expect(cache.byName['@ghost']).toBeUndefined();

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0]?.key).toBe(USERS_CACHE_KEY);
    expect(putCalls[0]?.options?.expirationTtl).toBe(CACHE_TTL_SECONDS);
  });

  it('returns the cached value on a KV hit without calling the client', async () => {
    const { kv } = createFakeKv();
    const client = createFakeClient();

    await getUsers(kv, client);
    expect(client.usersListCalls).toBe(2);

    const second = await getUsers(kv, client);
    expect(client.usersListCalls).toBe(2);
    expect(second.byId.U1).toEqual(alice);
  });

  it('bypasses the KV cache when force is set', async () => {
    const { kv } = createFakeKv();
    const client = createFakeClient();

    await getUsers(kv, client);
    expect(client.usersListCalls).toBe(2);

    await getUsers(kv, client, { force: true });
    expect(client.usersListCalls).toBe(4);
  });
});

describe('getChannels', () => {
  it('builds #name entries for channels and @user entries for DMs', async () => {
    const { kv } = createFakeKv();
    const client = createFakeClient();

    const cache = await getChannels(kv, client);

    expect(cache.byId).toEqual({ C1: general, C2: random, D1: dmWithAlice });
    expect(cache.byName['#general']).toBe('C1');
    expect(cache.byName['#random']).toBe('C2');
    expect(cache.byName['@alice']).toBe('D1');
  });
});

describe('resolveChannelId', () => {
  it('passes plain channel IDs through unchanged', async () => {
    const { kv } = createFakeKv();
    const client = createFakeClient();

    const id = await resolveChannelId(kv, client, 'C123');

    expect(id).toBe('C123');
    expect(client.conversationsListCalls).toBe(0);
    expect(client.usersListCalls).toBe(0);
  });

  it('resolves a #channel reference', async () => {
    const { kv } = createFakeKv();
    const client = createFakeClient();

    const id = await resolveChannelId(kv, client, '#general');

    expect(id).toBe('C1');
  });

  it('resolves an @user DM reference', async () => {
    const { kv } = createFakeKv();
    const client = createFakeClient();

    const id = await resolveChannelId(kv, client, '@alice');

    expect(id).toBe('D1');
  });

  it('refreshes exactly once then throws for an unknown name', async () => {
    const { kv } = createFakeKv();
    const client = createFakeClient();

    await expect(resolveChannelId(kv, client, '#nope')).rejects.toThrow(
      'channel "#nope" not found',
    );

    expect(client.conversationsListCalls).toBe(2);
  });
});

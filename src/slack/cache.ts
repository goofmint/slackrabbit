/**
 * KV-backed caches for Slack users and channels, plus name-to-ID resolution
 * for `#channel` / `@user` style references (issue #9).
 */

import type { SlackClient } from './client.js';
import type { SlackChannel, SlackUser } from './types.js';

/** Cached index of Slack users, keyed by ID and by `@name`. */
export type UsersCache = {
  byId: Record<string, SlackUser>;
  byName: Record<string, string>;
};

/** Cached index of Slack channels (including IMs), keyed by ID and by `#name` / `@name`. */
export type ChannelsCache = {
  byId: Record<string, SlackChannel>;
  byName: Record<string, string>;
};

/** The subset of {@link SlackClient} the cache layer depends on. */
export type CacheClient = Pick<SlackClient, 'conversationsList' | 'usersList'>;

/** KV key under which the users cache is stored. */
export const USERS_CACHE_KEY = 'users:v1';

/** KV key under which the channels cache is stored. */
export const CHANNELS_CACHE_KEY = 'channels:v1';

/** Time-to-live, in seconds, applied to cached KV entries (24 hours). */
export const CACHE_TTL_SECONDS = 86400;

/**
 * Fetches every page of `users.list` from Slack and concatenates the results.
 */
async function fetchAllUsers(client: CacheClient): Promise<SlackUser[]> {
  const members: SlackUser[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.usersList({ limit: 200, cursor });
    members.push(...page.members);
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return members;
}

/**
 * Fetches every page of `conversations.list` (public/private channels, MPIMs,
 * and IMs) from Slack and concatenates the results.
 */
async function fetchAllChannels(client: CacheClient): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const page = await client.conversationsList({
      types: 'public_channel,private_channel,mpim,im',
      limit: 200,
      cursor,
      exclude_archived: true,
    });
    channels.push(...page.channels);
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return channels;
}

/** Builds a {@link UsersCache} index from a flat list of Slack users. */
function buildUsersCache(members: SlackUser[]): UsersCache {
  const byId: Record<string, SlackUser> = {};
  const byName: Record<string, string> = {};

  for (const user of members) {
    byId[user.id] = user;
    if (!user.deleted) {
      byName[`@${user.name}`] = user.id;
    }
  }

  return { byId, byName };
}

/** Builds a {@link ChannelsCache} index from a flat list of Slack channels. */
function buildChannelsCache(channels: SlackChannel[], users: UsersCache): ChannelsCache {
  const byId: Record<string, SlackChannel> = {};
  const byName: Record<string, string> = {};

  for (const channel of channels) {
    byId[channel.id] = channel;

    if (channel.is_im) {
      if (channel.user) {
        const dmUser = users.byId[channel.user];
        if (dmUser) {
          byName[`@${dmUser.name}`] = channel.id;
        }
      }
    } else if (channel.name) {
      byName[`#${channel.name}`] = channel.id;
    }
  }

  return { byId, byName };
}

/**
 * Returns the cached Slack users index, fetching and populating it from
 * Slack (and writing it back to KV) on a cache miss or when `force` is set.
 */
export async function getUsers(
  kv: KVNamespace,
  client: CacheClient,
  opts?: { force?: boolean },
): Promise<UsersCache> {
  if (!opts?.force) {
    const cached = await kv.get<UsersCache>(USERS_CACHE_KEY, 'json');
    if (cached) {
      return cached;
    }
  }

  const members = await fetchAllUsers(client);
  const cache = buildUsersCache(members);
  await kv.put(USERS_CACHE_KEY, JSON.stringify(cache), { expirationTtl: CACHE_TTL_SECONDS });
  return cache;
}

/**
 * Returns the cached Slack channels index, fetching and populating it from
 * Slack (and writing it back to KV) on a cache miss or when `force` is set.
 */
export async function getChannels(
  kv: KVNamespace,
  client: CacheClient,
  opts?: { force?: boolean },
): Promise<ChannelsCache> {
  if (!opts?.force) {
    const cached = await kv.get<ChannelsCache>(CHANNELS_CACHE_KEY, 'json');
    if (cached) {
      return cached;
    }
  }

  const users = await getUsers(kv, client, opts);
  const channels = await fetchAllChannels(client);
  const cache = buildChannelsCache(channels, users);
  await kv.put(CHANNELS_CACHE_KEY, JSON.stringify(cache), { expirationTtl: CACHE_TTL_SECONDS });
  return cache;
}

/**
 * Resolves a `#channel` or `@user` reference to a Slack channel ID, using the
 * cached channels index. Inputs that don't start with `#` or `@` are assumed
 * to already be channel IDs and are returned unchanged. On a cache miss, the
 * channels cache is refreshed exactly once before giving up.
 */
export async function resolveChannelId(
  kv: KVNamespace,
  client: CacheClient,
  input: string,
): Promise<string> {
  if (!input.startsWith('#') && !input.startsWith('@')) {
    return input;
  }

  const channels = await getChannels(kv, client);
  const hit = channels.byName[input];
  if (hit) {
    return hit;
  }

  const refreshed = await getChannels(kv, client, { force: true });
  const refreshedHit = refreshed.byName[input];
  if (refreshedHit) {
    return refreshedHit;
  }

  throw new Error(`channel "${input}" not found`);
}

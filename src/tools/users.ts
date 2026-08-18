import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getChannels, getUsers } from '../slack/cache';
import type { SlackClient } from '../slack/client';
import type { SlackUser } from '../slack/types';
import { clampInt, csvResult, USER_HEADERS, type Row } from './shared';

/**
 * Returns true when `user` matches `query` case-insensitively against name,
 * real name, display name, profile real name, or email.
 */
function matchesQuery(user: SlackUser, query: string): boolean {
  const needle = query.toLowerCase();
  const haystacks = [
    user.name,
    user.real_name,
    user.profile?.display_name,
    user.profile?.real_name,
    user.profile?.email,
  ];
  return haystacks.some((value) => value !== undefined && value.toLowerCase().includes(needle));
}

/**
 * Registers the `users_search` tool (issue #10): searches Slack users by
 * name, real name, display name, or email, resolving each match's DM
 * channel ID from the channels cache.
 */
export function registerUsersSearch(server: McpServer, client: SlackClient, kv: KVNamespace): void {
  server.registerTool(
    'users_search',
    {
      title: 'Search users',
      description: 'Searches Slack users by name, real name, display name, or email.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Case-insensitive substring to match against name/real name/display name/email.'),
        limit: z.number().int().optional().describe('Max users to return (1-1000, default 50).'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const resolvedLimit = clampInt(limit, 50, 1, 1000);

      const users = await getUsers(kv, client);
      const channels = await getChannels(kv, client);

      const matches = Object.values(users.byId)
        .filter((user) => !user.deleted)
        .filter((user) => (query ? matchesQuery(user, query) : true))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, resolvedLimit);

      const rows: Row[] = matches.map((user) => ({
        UserID: user.id,
        UserName: user.name,
        RealName: user.real_name ?? user.profile?.real_name ?? '',
        DisplayName: user.profile?.display_name ?? '',
        Email: user.profile?.email ?? '',
        Title: user.profile?.title ?? '',
        DMChannelID: channels.byName[`@${user.name}`] ?? '',
      }));

      return csvResult(USER_HEADERS, rows);
    },
  );
}

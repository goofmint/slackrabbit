import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getUsers, resolveChannelId } from '../slack/cache';
import type { SlackClient } from '../slack/client';
import { clampInt, csvResult, filterActivity, messageRow, MESSAGE_HEADERS, withCursor, type Row } from './shared';

const channelIdParam = z
  .string()
  .describe('Channel ID (e.g. C0123ABCDEF), or a #channel-name / @user reference.');

const limitParam = z.number().int().optional().describe('Max messages to return (1-1000, default 50).');
const cursorParam = z.string().optional().describe('Pagination cursor from a previous call.');
const includeActivityParam = z
  .boolean()
  .optional()
  .describe('Include activity messages such as channel_join (default false).');

/**
 * Registers the `conversations_history` tool (issue #10): fetches recent
 * messages from a channel, resolving `#channel` / `@user` references and
 * user display names via the KV-backed caches.
 */
export function registerConversationsHistory(server: McpServer, client: SlackClient, kv: KVNamespace): void {
  server.registerTool(
    'conversations_history',
    {
      title: 'Get conversation history',
      description:
        "Fetches recent messages from a Slack channel. Supports pagination: the last row's " +
        'Cursor column is the cursor for the next call.',
      inputSchema: z.object({
        channel_id: channelIdParam,
        limit: limitParam,
        cursor: cursorParam,
        include_activity_messages: includeActivityParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ channel_id, limit, cursor, include_activity_messages }) => {
      const channel = await resolveChannelId(kv, client, channel_id);
      const resolvedLimit = clampInt(limit, 50, 1, 1000);

      const response = await client.conversationsHistory({ channel, limit: resolvedLimit, cursor });
      const users = await getUsers(kv, client);

      const messages = filterActivity(response.messages, include_activity_messages ?? false);
      const rows: Row[] = messages.map((m) => messageRow(m, channel, users));

      withCursor(rows, response.response_metadata?.next_cursor);
      return csvResult(MESSAGE_HEADERS, rows);
    },
  );
}

/**
 * Registers the `conversations_replies` tool (issue #10): fetches a thread's
 * replies, resolving `#channel` / `@user` references and user display names
 * via the KV-backed caches.
 */
export function registerConversationsReplies(server: McpServer, client: SlackClient, kv: KVNamespace): void {
  server.registerTool(
    'conversations_replies',
    {
      title: 'Get thread replies',
      description:
        "Fetches replies to a Slack thread. Supports pagination: the last row's Cursor " +
        'column is the cursor for the next call.',
      inputSchema: z.object({
        channel_id: channelIdParam,
        thread_ts: z.string().describe('The `ts` of the parent message that started the thread.'),
        limit: limitParam,
        cursor: cursorParam,
        include_activity_messages: includeActivityParam,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ channel_id, thread_ts, limit, cursor, include_activity_messages }) => {
      const channel = await resolveChannelId(kv, client, channel_id);
      const resolvedLimit = clampInt(limit, 50, 1, 1000);

      const response = await client.conversationsReplies({
        channel,
        ts: thread_ts,
        limit: resolvedLimit,
        cursor,
      });
      const users = await getUsers(kv, client);

      const messages = filterActivity(response.messages, include_activity_messages ?? false);
      const rows: Row[] = messages.map((m) => messageRow(m, channel, users));

      withCursor(rows, response.response_metadata?.next_cursor);
      return csvResult(MESSAGE_HEADERS, rows);
    },
  );
}

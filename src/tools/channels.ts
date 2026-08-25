import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { SlackClient } from '../slack/client';
import { CHANNEL_HEADERS, clampInt, csvResult, withCursor, type Row } from './shared';

/**
 * Registers the `channels_list` tool (issue #10): lists public/private
 * channels, MPIMs, and/or IMs visible to the configured Slack token.
 */
export function registerChannelsList(server: McpServer, client: SlackClient, _kv: KVNamespace): void {
  server.registerTool(
    'channels_list',
    {
      title: 'List channels',
      description:
        'Lists Slack channels visible to the configured token. Supports pagination: ' +
        "the last row's Cursor column is the cursor for the next call.",
      inputSchema: z.object({
        channel_types: z
          .string()
          .optional()
          .describe(
            'Comma-separated channel types to include: public_channel, private_channel, mpim, im. ' +
              'Defaults to public_channel,private_channel.',
          ),
        limit: z.number().int().optional().describe('Max channels to return (1-1000, default 100).'),
        cursor: z.string().optional().describe('Pagination cursor from a previous call.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ channel_types, limit, cursor }) => {
      const types = channel_types ?? 'public_channel,private_channel';
      const resolvedLimit = clampInt(limit, 100, 1, 1000);

      const response = await client.conversationsList({
        types,
        limit: resolvedLimit,
        cursor,
        exclude_archived: true,
      });

      const rows: Row[] = response.channels.map((channel) => ({
        ID: channel.id,
        Name: channel.name ?? '',
        Topic: channel.topic?.value ?? '',
        Purpose: channel.purpose?.value ?? '',
        MemberCount: channel.num_members ?? '',
        Cursor: '',
      }));

      withCursor(rows, response.response_metadata?.next_cursor);
      return csvResult(CHANNEL_HEADERS, rows);
    },
  );
}

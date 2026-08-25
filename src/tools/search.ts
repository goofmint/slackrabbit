import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getUsers } from '../slack/cache';
import type { SlackClient } from '../slack/client';
import { MESSAGE_HEADERS, clampInt, csvResult, messageRow, withCursor } from './shared';

/**
 * Registers `conversations_search_messages` (issue #11), a thin wrapper over
 * Slack's `search.messages` Web API method.
 *
 * `search.messages` is user-token-only — {@link SlackClient.searchMessages}
 * rejects when no `SLACK_XOXP_TOKEN` is configured, so this handler does not
 * re-check for a token itself. Callers (src/mcp.ts, T-13) are responsible for
 * only registering this tool when a user token exists.
 *
 * Pagination here is PAGE-based (matching `search.messages`'s own paging
 * shape), unlike the cursor-based pagination used by other tools: the `Cursor`
 * column of the last row holds the next page NUMBER, to be passed back as the
 * `page` input.
 */
export function registerSearchMessages(server: McpServer, client: SlackClient, kv: KVNamespace): void {
  server.registerTool(
    'conversations_search_messages',
    {
      title: 'Search Messages',
      description:
        'Searches Slack messages using search.messages (requires a user token). ' +
        'The query supports Slack search operators, e.g. `in:#channel`, `from:@user`, ' +
        '`after:2026-01-01`, `before:2026-01-01`. Cursor holds the NEXT PAGE NUMBER ' +
        'to pass back as `page` (not an opaque cursor).',
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'Slack search query. Supports search operators such as `in:#channel`, ' +
              '`from:@user`, `after:2026-01-01`, `before:2026-01-01`.',
          ),
        count: z.number().optional().describe('Results per page (default 20, clamped 1-100).'),
        page: z.number().optional().describe('Page number to fetch (default 1, minimum 1).'),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const count = clampInt(args.count, 20, 1, 100);
      const page = clampInt(args.page, 1, 1, Number.MAX_SAFE_INTEGER);

      const res = await client.searchMessages({ query: args.query, count, page });
      const users = await getUsers(kv, client);

      const rows = res.messages.matches.map((m) =>
        messageRow(m, m.channel?.name ? `#${m.channel.name}` : (m.channel?.id ?? ''), users),
      );

      const paging = res.messages.paging;
      const next =
        paging && paging.page !== undefined && paging.pages !== undefined && paging.page < paging.pages
          ? String(paging.page + 1)
          : undefined;

      return csvResult(MESSAGE_HEADERS, withCursor(rows, next));
    },
  );
}

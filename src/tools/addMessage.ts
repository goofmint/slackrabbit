import { z } from 'zod';
import type { McpServer, CallToolResult } from '@modelcontextprotocol/server';
import { githubMarkdownToMrkdwn } from '../format/mrkdwn';
import { isChannelAllowed, type PostPolicy } from '../postGuard';
import { resolveChannelId } from '../slack/cache';
import type { SlackClient } from '../slack/client';

/**
 * Registers the `conversations_add_message` tool (issue #12) — the only tool
 * in this server that writes to Slack. It posts a CodeRabbit code review
 * result (or any other message) into a channel, gated by the
 * `SLACK_MCP_ADD_MESSAGE_TOOL` policy.
 *
 * Registration is conditional: `src/mcp.ts` only calls this when
 * `policy.kind !== 'disabled'`, so a fully disabled policy means the tool
 * isn't advertised to the client at all rather than being registered and
 * always rejecting.
 *
 * The returned `ts` (Slack message timestamp) can be passed back in as
 * `thread_ts` on a later call to reply in a thread — e.g. to post follow-up
 * comments under the original review message.
 */
export function registerAddMessage(
  server: McpServer,
  client: SlackClient,
  kv: KVNamespace,
  policy: PostPolicy,
): void {
  server.registerTool(
    'conversations_add_message',
    {
      title: 'Post message to Slack',
      description:
        'Posts a CodeRabbit code review result (or any other message) to a Slack channel or thread. ' +
        'Posting is gated by the SLACK_MCP_ADD_MESSAGE_TOOL policy: the target channel must be allowed ' +
        'by that policy or the call fails. The returned `ts` can be passed back in as `thread_ts` on a ' +
        'later call to post a follow-up message in the same thread.',
      inputSchema: z.object({
        channel_id: z
          .string()
          .describe('Target channel: a channel ID (e.g. "C0123456789"), "#channel-name", or "@user".'),
        text: z.string().describe('Message text to post.'),
        thread_ts: z
          .string()
          .optional()
          .describe('Parent message timestamp to reply in a thread.'),
        content_type: z
          .enum(['text/markdown', 'text/plain'])
          .optional()
          .default('text/markdown')
          .describe('How `text` is interpreted: GitHub-flavored markdown (converted to Slack mrkdwn) or plain text verbatim.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ channel_id, text, thread_ts, content_type }): Promise<CallToolResult> => {
      // Step 1 MUST run before step 2: resolve #channel/@user references to a
      // real channel ID first, then check the policy against that resolved
      // ID. Checking the policy against the raw input would let an
      // unresolved name like "#general" bypass an allow-list keyed on
      // resolved channel IDs.
      const resolved = await resolveChannelId(kv, client, channel_id);

      if (!isChannelAllowed(policy, resolved)) {
        throw new Error(`channel ${resolved} is not allowed by SLACK_MCP_ADD_MESSAGE_TOOL`);
      }

      const mrkdwn = content_type !== 'text/plain';
      const body = mrkdwn ? githubMarkdownToMrkdwn(text) : text;

      const res = await client.postMessage({
        channel: resolved,
        text: body,
        thread_ts,
        mrkdwn,
        unfurl_links: false,
        unfurl_media: false,
      });

      const message = thread_ts
        ? `Successfully posted message to channel ${res.channel} in thread ${thread_ts} (ts=${res.ts})`
        : `Successfully posted message to channel ${res.channel} (ts=${res.ts})`;

      return { content: [{ type: 'text', text: message }] };
    },
  );
}

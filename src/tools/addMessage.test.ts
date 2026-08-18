import { McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsCache } from '../slack/cache';
import type { PostMessageResult } from '../slack/client';
import type { SlackClient } from '../slack/client';
import type { PostPolicy } from '../postGuard';
import { registerAddMessage } from './addMessage';

type ToolHandler = (args: {
  channel_id: string;
  text: string;
  thread_ts?: string;
  content_type?: 'text/markdown' | 'text/plain';
}) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

const channelsCache: ChannelsCache = {
  byId: {},
  byName: { '#general': 'C1', '#secret': 'C2', '@bob': 'D1' },
};

/** Minimal fake KV: `get` resolves the preset channels cache, `put` is a no-op spy. */
function fakeKv(): KVNamespace {
  return {
    get: vi.fn(async () => channelsCache),
    put: vi.fn(async () => undefined),
  } as unknown as KVNamespace;
}

describe('registerAddMessage', () => {
  let server: McpServer;
  let registerToolSpy: ReturnType<typeof vi.spyOn>;
  let postMessage: ReturnType<typeof vi.fn>;
  let client: SlackClient;
  let kv: KVNamespace;

  beforeEach(() => {
    server = new McpServer({ name: 't', version: '0' });
    registerToolSpy = vi.spyOn(server, 'registerTool');
    postMessage = vi.fn(
      async (): Promise<PostMessageResult> => ({ channel: 'C1', ts: '1.2' }),
    );
    client = {
      postMessage,
      conversationsList: vi.fn(),
      usersList: vi.fn(),
    } as unknown as SlackClient;
    kv = fakeKv();
  });

  function registerAndGetHandler(policy: PostPolicy): ToolHandler {
    registerAddMessage(server, client, kv, policy);
    const calls = registerToolSpy.mock.calls as unknown as Array<[string, unknown, unknown]>;
    const call = calls.find((c) => c[0] === 'conversations_add_message');
    if (!call) throw new Error('conversations_add_message was not registered');
    return call[2] as ToolHandler;
  }

  describe('allow-list policy ({ kind: "allow", channels: {C1} })', () => {
    const policy: PostPolicy = { kind: 'allow', channels: new Set(['C1']) };

    it('posts to an allowed channel ID', async () => {
      const handler = registerAndGetHandler(policy);
      const result = await handler({ channel_id: 'C1', text: 'hi' });
      expect(postMessage).toHaveBeenCalledOnce();
      expect(result.content[0]?.text).toContain('Successfully posted message to channel C1');
    });

    it('resolves "#general" to C1 and posts OK', async () => {
      const handler = registerAndGetHandler(policy);
      await handler({ channel_id: '#general', text: 'hi' });
      expect(postMessage).toHaveBeenCalledOnce();
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C1' }),
      );
    });

    it('rejects C2 with the exact error message', async () => {
      const handler = registerAndGetHandler(policy);
      await expect(handler({ channel_id: 'C2', text: 'hi' })).rejects.toThrow(
        'channel C2 is not allowed by SLACK_MCP_ADD_MESSAGE_TOOL',
      );
      expect(postMessage).not.toHaveBeenCalled();
    });

    it('resolves "#secret" to C2 and rejects it, proving resolve-then-guard order', async () => {
      const handler = registerAndGetHandler(policy);
      await expect(handler({ channel_id: '#secret', text: 'hi' })).rejects.toThrow(
        'channel C2 is not allowed by SLACK_MCP_ADD_MESSAGE_TOOL',
      );
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe('deny-list policy ({ kind: "deny", channels: {!C2} })', () => {
    const policy: PostPolicy = { kind: 'deny', channels: new Set(['C2']) };

    it('allows C1', async () => {
      const handler = registerAndGetHandler(policy);
      await handler({ channel_id: 'C1', text: 'hi' });
      expect(postMessage).toHaveBeenCalledOnce();
    });

    it('rejects C2', async () => {
      const handler = registerAndGetHandler(policy);
      await expect(handler({ channel_id: 'C2', text: 'hi' })).rejects.toThrow(
        'channel C2 is not allowed by SLACK_MCP_ADD_MESSAGE_TOOL',
      );
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  it('posts anywhere under an "all" policy', async () => {
    const handler = registerAndGetHandler({ kind: 'all' });
    await handler({ channel_id: 'C999', text: 'hi' });
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('converts markdown to mrkdwn and sets mrkdwn true by default', async () => {
    const handler = registerAndGetHandler({ kind: 'all' });
    await handler({ channel_id: 'C1', text: '**b** [t](u)' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*b* <u|t>', mrkdwn: true }),
    );
  });

  it('sends text/plain verbatim with mrkdwn false', async () => {
    const handler = registerAndGetHandler({ kind: 'all' });
    await handler({ channel_id: 'C1', text: '**b** [t](u)', content_type: 'text/plain' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '**b** [t](u)', mrkdwn: false }),
    );
  });

  it('always disables link/media unfurling', async () => {
    const handler = registerAndGetHandler({ kind: 'all' });
    await handler({ channel_id: 'C1', text: 'hi' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ unfurl_links: false, unfurl_media: false }),
    );
  });

  it('passes thread_ts through and mentions the thread in the return string', async () => {
    const handler = registerAndGetHandler({ kind: 'all' });
    const result = await handler({ channel_id: 'C1', text: 'hi', thread_ts: '111.222' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '111.222' }),
    );
    expect(result.content[0]?.text).toContain('in thread');
  });

  it('includes ts=1.2 in the return string', async () => {
    const handler = registerAndGetHandler({ kind: 'all' });
    const result = await handler({ channel_id: 'C1', text: 'hi' });
    expect(result.content[0]?.text).toContain('ts=1.2');
  });
});

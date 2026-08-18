import type { CallToolResult } from '@modelcontextprotocol/server';
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import type { SlackClient } from '../slack/client';
import type { SlackChannel, SlackMessage, SlackUser } from '../slack/types';
import { registerChannelsList } from './channels';
import { registerConversationsHistory, registerConversationsReplies } from './conversations';
import { registerUsersSearch } from './users';

/** Minimal in-memory KV stand-in, sufficient for `getUsers`/`getChannels`/`resolveChannelId`. */
function createFakeKv(): KVNamespace {
  const store = new Map<string, string>();
  const fake = {
    get: async (key: string, _options?: unknown): Promise<unknown> => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return JSON.parse(raw);
    },
    put: async (key: string, value: string, _opts?: unknown): Promise<void> => {
      store.set(key, value);
    },
  };
  return fake as unknown as KVNamespace;
}

/** Minimal fake `SlackClient`; only the methods under test need real behavior. */
function createFakeClient(): SlackClient {
  const fake = {
    conversationsList: vi.fn(),
    conversationsHistory: vi.fn(),
    conversationsReplies: vi.fn(),
    usersList: vi.fn(),
    searchMessages: vi.fn(),
    postMessage: vi.fn(),
  };
  return fake as unknown as SlackClient;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

/**
 * Invokes `register` against a real `McpServer` with `registerTool` mocked
 * out (so no JSON-schema validator setup is needed), and returns the
 * captured handler so it can be called directly with plain args.
 */
function captureHandler(server: McpServer, register: (server: McpServer) => void): ToolHandler {
  let captured: unknown;
  const fakeImplementation = (..._args: unknown[]): unknown => {
    captured = _args[2];
    return {};
  };
  const spy = vi
    .spyOn(server, 'registerTool')
    .mockImplementation(fakeImplementation as unknown as typeof server.registerTool);
  register(server);
  spy.mockRestore();
  return captured as ToolHandler;
}

/** Splits a `csvResult` CallToolResult's CSV text into header + data rows. */
function parseCsv(result: CallToolResult): { headers: string[]; rows: string[][] } {
  const text = result.content[0];
  if (!text || text.type !== 'text') throw new Error('expected a text content block');
  const lines = text.text.split('\n');
  const headers = (lines[0] ?? '').split(',');
  const rows = lines.slice(1).map((line) => line.split(','));
  return { headers, rows };
}

function makeUser(overrides: Partial<SlackUser> & { id: string; name: string }): SlackUser {
  return overrides;
}

function makeChannel(overrides: Partial<SlackChannel> & { id: string }): SlackChannel {
  return overrides;
}

function makeMessage(overrides: Partial<SlackMessage> & { ts: string }): SlackMessage {
  return overrides;
}

describe('channels_list', () => {
  it('returns channel rows and sets Cursor on the last row', async () => {
    const kv = createFakeKv();
    const client = createFakeClient();
    (client.conversationsList as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        makeChannel({ id: 'C1', name: 'general', topic: { value: 'General chat' }, purpose: { value: 'Everything' }, num_members: 5 }),
        makeChannel({ id: 'C2', name: 'random' }),
      ],
      response_metadata: { next_cursor: 'next-page' },
    });

    const server = new McpServer({ name: 't', version: '0' });
    const handler = captureHandler(server, (s) => registerChannelsList(s, client, kv));

    const result = await handler({});
    const { headers, rows } = parseCsv(result);

    expect(headers).toEqual(['ID', 'Name', 'Topic', 'Purpose', 'MemberCount', 'Cursor']);
    expect(rows).toEqual([
      ['C1', 'general', 'General chat', 'Everything', '5', ''],
      ['C2', 'random', '', '', '', 'next-page'],
    ]);
    expect(client.conversationsList).toHaveBeenCalledWith({
      types: 'public_channel,private_channel',
      limit: 100,
      cursor: undefined,
      exclude_archived: true,
    });
  });
});

describe('users_search', () => {
  function setUpUsersAndChannels(client: SlackClient): void {
    (client.usersList as ReturnType<typeof vi.fn>).mockResolvedValue({
      members: [
        makeUser({
          id: 'U1',
          name: 'alice',
          real_name: 'Alice Anderson',
          profile: { display_name: 'ali', email: 'alice@example.com', title: 'Engineer' },
        }),
        makeUser({
          id: 'U2',
          name: 'bob',
          real_name: 'Bob Brown',
          profile: { display_name: 'bobby', email: 'bob@example.com', title: 'Manager' },
        }),
        makeUser({ id: 'U3', name: 'carol', deleted: true }),
      ],
      response_metadata: {},
    });
    (client.conversationsList as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [
        makeChannel({ id: 'D1', is_im: true, user: 'U1' }),
        makeChannel({ id: 'D2', is_im: true, user: 'U2' }),
      ],
      response_metadata: {},
    });
  }

  it('filters by query and fills DMChannelID from the channels cache', async () => {
    const kv = createFakeKv();
    const client = createFakeClient();
    setUpUsersAndChannels(client);

    const server = new McpServer({ name: 't', version: '0' });
    const handler = captureHandler(server, (s) => registerUsersSearch(s, client, kv));

    const result = await handler({ query: 'alice' });
    const { headers, rows } = parseCsv(result);

    expect(headers).toEqual(['UserID', 'UserName', 'RealName', 'DisplayName', 'Email', 'Title', 'DMChannelID']);
    expect(rows).toEqual([['U1', 'alice', 'Alice Anderson', 'ali', 'alice@example.com', 'Engineer', 'D1']]);
  });

  it('excludes deleted users and returns all matches without a query', async () => {
    const kv = createFakeKv();
    const client = createFakeClient();
    setUpUsersAndChannels(client);

    const server = new McpServer({ name: 't', version: '0' });
    const handler = captureHandler(server, (s) => registerUsersSearch(s, client, kv));

    const result = await handler({});
    const { rows } = parseCsv(result);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r[0])).toEqual(['U1', 'U2']);
  });
});

describe('conversations_history', () => {
  function setUpChannelsAndUsers(client: SlackClient): void {
    (client.usersList as ReturnType<typeof vi.fn>).mockResolvedValue({
      members: [makeUser({ id: 'U1', name: 'alice', real_name: 'Alice Anderson' })],
      response_metadata: {},
    });
    (client.conversationsList as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [makeChannel({ id: 'C1', name: 'general' })],
      response_metadata: {},
    });
  }

  it('resolves #general, drops channel_join, and fills UserName/RealName', async () => {
    const kv = createFakeKv();
    const client = createFakeClient();
    setUpChannelsAndUsers(client);
    (client.conversationsHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        makeMessage({ ts: '1700000000.000100', user: 'U1', text: 'hello' }),
        makeMessage({ ts: '1700000000.000200', user: 'U1', text: 'joined', subtype: 'channel_join' }),
      ],
      response_metadata: { next_cursor: 'cursor-abc' },
    });

    const server = new McpServer({ name: 't', version: '0' });
    const handler = captureHandler(server, (s) => registerConversationsHistory(s, client, kv));

    const result = await handler({ channel_id: '#general' });
    const { headers, rows } = parseCsv(result);

    expect(headers).toEqual(['MsgID', 'UserID', 'UserName', 'RealName', 'Channel', 'ThreadTs', 'Text', 'Time', 'Permalink', 'Cursor']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe('1700000000.000100');
    expect(rows[0]?.[2]).toBe('alice');
    expect(rows[0]?.[3]).toBe('Alice Anderson');
    expect(rows[0]?.[9]).toBe('cursor-abc');

    expect(client.conversationsHistory).toHaveBeenCalledWith({ channel: 'C1', limit: 50, cursor: undefined });
  });

  it('includes activity messages when include_activity_messages is true', async () => {
    const kv = createFakeKv();
    const client = createFakeClient();
    setUpChannelsAndUsers(client);
    (client.conversationsHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        makeMessage({ ts: '1700000000.000100', user: 'U1', text: 'hello' }),
        makeMessage({ ts: '1700000000.000200', user: 'U1', text: 'joined', subtype: 'channel_join' }),
      ],
      response_metadata: {},
    });

    const server = new McpServer({ name: 't', version: '0' });
    const handler = captureHandler(server, (s) => registerConversationsHistory(s, client, kv));

    const result = await handler({ channel_id: 'C1', include_activity_messages: true });
    const { rows } = parseCsv(result);

    expect(rows).toHaveLength(2);
  });
});

describe('conversations_replies', () => {
  it('passes ts=thread_ts through to conversations.replies', async () => {
    const kv = createFakeKv();
    const client = createFakeClient();
    (client.usersList as ReturnType<typeof vi.fn>).mockResolvedValue({ members: [], response_metadata: {} });
    (client.conversationsReplies as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [makeMessage({ ts: '1700000000.000100', text: 'reply' })],
      response_metadata: {},
    });

    const server = new McpServer({ name: 't', version: '0' });
    const handler = captureHandler(server, (s) => registerConversationsReplies(s, client, kv));

    await handler({ channel_id: 'C1', thread_ts: '1700000000.000000' });

    expect(client.conversationsReplies).toHaveBeenCalledWith({
      channel: 'C1',
      ts: '1700000000.000000',
      limit: 50,
      cursor: undefined,
    });
  });
});

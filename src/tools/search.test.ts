import { McpServer } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsersCache } from '../slack/cache';
import type { SlackClient } from '../slack/client';
import type { SearchMessagesResult } from '../slack/client';
import type { SlackUser } from '../slack/types';
import { registerSearchMessages } from './search';

type ToolHandler = (args: {
  query: string;
  count?: number;
  page?: number;
}) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

/** Minimal fake KV: `get` resolves a preset users cache, `put` is a no-op spy. */
function fakeKv(cache: UsersCache): KVNamespace {
  return {
    get: vi.fn(async () => cache),
    put: vi.fn(async () => undefined),
  } as unknown as KVNamespace;
}

function fakeUser(id: string, name: string, realName: string): SlackUser {
  return { id, name, real_name: realName };
}

const usersCache: UsersCache = {
  byId: {
    U1: fakeUser('U1', 'alice', 'Alice Anderson'),
  },
  byName: { '@alice': 'U1' },
};

function makeSearchResult(
  overrides?: Partial<SearchMessagesResult['messages']>,
): SearchMessagesResult {
  return {
    messages: {
      matches: [],
      paging: { count: 20, total: 0, page: 1, pages: 1 },
      ...overrides,
    },
  };
}

describe('registerSearchMessages', () => {
  let server: McpServer;
  let registerToolSpy: ReturnType<typeof vi.spyOn>;
  let searchMessages: ReturnType<typeof vi.fn>;
  let client: SlackClient;

  beforeEach(() => {
    server = new McpServer({ name: 't', version: '0' });
    registerToolSpy = vi.spyOn(server, 'registerTool');
    searchMessages = vi.fn(async () => makeSearchResult());
    client = { searchMessages } as unknown as SlackClient;
  });

  function registerAndGetHandler(kv: KVNamespace): ToolHandler {
    registerSearchMessages(server, client, kv);
    const calls = registerToolSpy.mock.calls as unknown as Array<[string, unknown, unknown]>;
    const call = calls.find((c) => c[0] === 'conversations_search_messages');
    if (!call) throw new Error('conversations_search_messages was not registered');
    return call[2] as ToolHandler;
  }

  it('passes query/count/page to searchMessages with defaults', async () => {
    const handler = registerAndGetHandler(fakeKv(usersCache));
    await handler({ query: 'hello' });
    expect(searchMessages).toHaveBeenCalledWith({ query: 'hello', count: 20, page: 1 });
  });

  it('clamps count to 100', async () => {
    const handler = registerAndGetHandler(fakeKv(usersCache));
    await handler({ query: 'hello', count: 500, page: 1 });
    expect(searchMessages).toHaveBeenCalledWith({ query: 'hello', count: 100, page: 1 });
  });

  it('fills rows from matches and users cache', async () => {
    searchMessages.mockResolvedValueOnce(
      makeSearchResult({
        matches: [
          {
            ts: '1700000000.000100',
            user: 'U1',
            text: 'hi there',
            permalink: 'https://slack.example/archives/C1/p1700000000000100',
            channel: { id: 'C1', name: 'general' },
          },
        ],
        paging: { count: 20, total: 1, page: 1, pages: 1 },
      }),
    );
    const handler = registerAndGetHandler(fakeKv(usersCache));
    const result = await handler({ query: 'hi' });
    const text = result.content[0]?.text ?? '';
    const lines = text.split('\n');
    expect(lines[0]).toBe('MsgID,UserID,UserName,RealName,Channel,ThreadTs,Text,Time,Permalink,Cursor');
    const dataLine = lines[1] ?? '';
    expect(dataLine).toContain('alice');
    expect(dataLine).toContain('#general');
    expect(dataLine).toContain('https://slack.example/archives/C1/p1700000000000100');
  });

  it('sets Cursor to next page number when not on the last page', async () => {
    searchMessages.mockResolvedValueOnce(
      makeSearchResult({
        matches: [
          {
            ts: '1700000000.000100',
            user: 'U1',
            text: 'hi',
            channel: { id: 'C1', name: 'general' },
          },
        ],
        paging: { count: 20, total: 60, page: 1, pages: 3 },
      }),
    );
    const handler = registerAndGetHandler(fakeKv(usersCache));
    const result = await handler({ query: 'hi' });
    const text = result.content[0]?.text ?? '';
    const dataLine = text.split('\n')[1] ?? '';
    const cursor = dataLine.split(',').pop();
    expect(cursor).toBe('2');
  });

  it('leaves Cursor empty on the last page', async () => {
    searchMessages.mockResolvedValueOnce(
      makeSearchResult({
        matches: [
          {
            ts: '1700000000.000100',
            user: 'U1',
            text: 'hi',
            channel: { id: 'C1', name: 'general' },
          },
        ],
        paging: { count: 20, total: 60, page: 3, pages: 3 },
      }),
    );
    const handler = registerAndGetHandler(fakeKv(usersCache));
    const result = await handler({ query: 'hi' });
    const text = result.content[0]?.text ?? '';
    const dataLine = text.split('\n')[1] ?? '';
    const cursor = dataLine.split(',').pop();
    expect(cursor).toBe('');
  });

  it('returns a header-only CSV when there are no matches', async () => {
    searchMessages.mockResolvedValueOnce(makeSearchResult());
    const handler = registerAndGetHandler(fakeKv(usersCache));
    const result = await handler({ query: 'nothing' });
    const text = result.content[0]?.text ?? '';
    expect(text).toBe('MsgID,UserID,UserName,RealName,Channel,ThreadTs,Text,Time,Permalink,Cursor');
  });
});

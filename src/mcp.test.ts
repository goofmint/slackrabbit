import { describe, expect, it } from 'vitest';
import type { Config } from './config';
import { createServer } from './mcp';

const kv = {} as unknown as KVNamespace;

function makeCfg(overrides: Partial<Config> = {}): Config {
  return {
    xoxp: 'xoxp-test',
    xoxb: 'xoxb-test',
    mcpApiKey: undefined,
    addMessagePolicy: { kind: 'disabled' },
    readToken: 'xoxp-test',
    postToken: 'xoxb-test',
    searchEnabled: true,
    ...overrides,
  };
}

/** Lists registered tool names via the SDK's internal registry. */
function toolNames(cfg: Config): string[] {
  const server = createServer(cfg, kv);
  // `_registeredTools` is private in the type; access through a narrowed view.
  const registry = (server as unknown as { _registeredTools: Record<string, unknown> })
    ._registeredTools;
  return Object.keys(registry).sort();
}

const READ_TOOLS = [
  'channels_list',
  'conversations_history',
  'conversations_replies',
  'users_search',
];

describe('createServer registration matrix', () => {
  it('registers only the four read tools when xoxb-only and posting disabled', () => {
    const names = toolNames(
      makeCfg({ xoxp: undefined, readToken: 'xoxb-test', searchEnabled: false }),
    );
    expect(names).toEqual(READ_TOOLS);
  });

  it('adds conversations_search_messages when xoxp is present', () => {
    const names = toolNames(makeCfg());
    expect(names).toEqual([...READ_TOOLS, 'conversations_search_messages'].sort());
  });

  it('adds conversations_add_message only when the post policy is enabled', () => {
    expect(toolNames(makeCfg())).not.toContain('conversations_add_message');
    const names = toolNames(makeCfg({ addMessagePolicy: { kind: 'all' } }));
    expect(names).toContain('conversations_add_message');
  });

  it('exposes all six tools with both tokens and an allow-list policy', () => {
    const names = toolNames(
      makeCfg({ addMessagePolicy: { kind: 'allow', channels: new Set(['C1']) } }),
    );
    expect(names).toEqual(
      [...READ_TOOLS, 'conversations_search_messages', 'conversations_add_message'].sort(),
    );
  });
});

import { describe, it, expect } from 'vitest';
import { loadConfig } from './config';
import type { Env } from './env';

// Minimal stub: loadConfig never touches SLACK_CACHE, so an empty object
// cast is sufficient here. Acceptable in tests only.
const kv = {} as KVNamespace;

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    SLACK_CACHE: kv,
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('derives readToken/postToken/searchEnabled from xoxp only', () => {
    const config = loadConfig(baseEnv({ SLACK_XOXP_TOKEN: 'xoxp-1' }));
    expect(config.readToken).toBe('xoxp-1');
    expect(config.postToken).toBe('xoxp-1');
    expect(config.searchEnabled).toBe(true);
    expect(config.xoxp).toBe('xoxp-1');
    expect(config.xoxb).toBeUndefined();
  });

  it('derives readToken/postToken/searchEnabled from xoxb only', () => {
    const config = loadConfig(baseEnv({ SLACK_XOXB_TOKEN: 'xoxb-1' }));
    expect(config.readToken).toBe('xoxb-1');
    expect(config.postToken).toBe('xoxb-1');
    expect(config.searchEnabled).toBe(false);
    expect(config.xoxb).toBe('xoxb-1');
    expect(config.xoxp).toBeUndefined();
  });

  it('prefers xoxp for read and xoxb for post when both are set, and enables search', () => {
    const config = loadConfig(
      baseEnv({ SLACK_XOXP_TOKEN: 'xoxp-1', SLACK_XOXB_TOKEN: 'xoxb-1' }),
    );
    expect(config.readToken).toBe('xoxp-1');
    expect(config.postToken).toBe('xoxb-1');
    expect(config.searchEnabled).toBe(true);
  });

  it('throws with the exact message when neither token is set', () => {
    expect(() => loadConfig(baseEnv())).toThrow(
      'SLACK_XOXP_TOKEN or SLACK_XOXB_TOKEN must be set',
    );
  });

  it('treats empty-string tokens as unset', () => {
    expect(() =>
      loadConfig(baseEnv({ SLACK_XOXP_TOKEN: '', SLACK_XOXB_TOKEN: '   ' })),
    ).toThrow('SLACK_XOXP_TOKEN or SLACK_XOXB_TOKEN must be set');
  });

  it('propagates the postGuard error for mixed allow/deny channel lists', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          SLACK_XOXP_TOKEN: 'xoxp-1',
          SLACK_MCP_ADD_MESSAGE_TOOL: 'C1,!C2',
        }),
      ),
    ).toThrow('cannot mix allowed and disallowed (! prefixed) channels');
  });

  it('defaults addMessagePolicy to disabled when unset', () => {
    const config = loadConfig(baseEnv({ SLACK_XOXP_TOKEN: 'xoxp-1' }));
    expect(config.addMessagePolicy.kind).toBe('disabled');
  });

  it('passes mcpApiKey through', () => {
    const config = loadConfig(
      baseEnv({ SLACK_XOXP_TOKEN: 'xoxp-1', MCP_API_KEY: 'secret-key' }),
    );
    expect(config.mcpApiKey).toBe('secret-key');
  });
});

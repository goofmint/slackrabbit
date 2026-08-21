import type { Env } from './env';
import { parsePostPolicy, type PostPolicy } from './postGuard';

/**
 * Resolved runtime configuration, derived from {@link Env}.
 *
 * Derivation table (given the presence/absence of the two Slack tokens):
 *
 * | xoxp set | xoxb set | readToken | postToken | searchEnabled |
 * |----------|----------|-----------|-----------|---------------|
 * | yes      | yes      | xoxp      | xoxb      | true          |
 * | yes      | no       | xoxp      | xoxp      | true          |
 * | no       | yes      | xoxb      | xoxb      | false         |
 * | no       | no       | (throws during `loadConfig`)          |
 *
 * - `readToken` prefers the user token (`xoxp`) because it is required for
 *   read-only APIs such as `search.messages` when both are absent it falls
 *   back to the bot token (`xoxb`).
 * - `postToken` prefers the bot token (`xoxb`) so that messages are posted
 *   under the bot's identity rather than impersonating a user; it falls
 *   back to `xoxp` when no bot token is configured.
 * - `searchEnabled` is `true` only when `xoxp` is set, since
 *   `search.messages` is a user-token-only Slack Web API method.
 */
export type Config = {
  xoxp?: string;
  xoxb?: string;
  mcpApiKey?: string;
  addMessagePolicy: PostPolicy;
  readToken: string;
  postToken: string;
  searchEnabled: boolean;
};

/**
 * Normalizes a raw environment variable value: trims whitespace, and
 * treats an empty result as unset (`undefined`).
 */
function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * Reads and validates the worker's environment into a {@link Config}.
 *
 * Throws if neither `SLACK_XOXP_TOKEN` nor `SLACK_XOXB_TOKEN` is set (after
 * treating empty/whitespace-only values as unset), and propagates any error
 * thrown by {@link parsePostPolicy} when `SLACK_MCP_ADD_MESSAGE_TOOL` mixes
 * allow- and deny-listed channels.
 *
 * Never logs token values.
 */
export function loadConfig(env: Env): Config {
  const xoxp = normalize(env.SLACK_XOXP_TOKEN);
  const xoxb = normalize(env.SLACK_XOXB_TOKEN);
  const mcpApiKey = normalize(env.MCP_API_KEY);

  if (xoxp === undefined && xoxb === undefined) {
    throw new Error('SLACK_XOXP_TOKEN or SLACK_XOXB_TOKEN must be set');
  }

  const addMessagePolicy = parsePostPolicy(env.SLACK_MCP_ADD_MESSAGE_TOOL);

  const readToken = xoxp ?? xoxb;
  const postToken = xoxb ?? xoxp;

  if (readToken === undefined || postToken === undefined) {
    // Unreachable: guarded by the check above, but keeps types precise
    // without a non-null assertion.
    throw new Error('SLACK_XOXP_TOKEN or SLACK_XOXB_TOKEN must be set');
  }

  return {
    xoxp,
    xoxb,
    mcpApiKey,
    addMessagePolicy,
    readToken,
    postToken,
    searchEnabled: xoxp !== undefined,
  };
}

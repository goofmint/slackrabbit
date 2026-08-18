/**
 * Worker bindings. Secrets (tokens, API key) are set via `wrangler secret put`;
 * SLACK_MCP_ADD_MESSAGE_TOOL comes from `vars` in wrangler.jsonc.
 */
export type Env = {
  SLACK_CACHE: KVNamespace;
  SLACK_XOXP_TOKEN?: string;
  SLACK_XOXB_TOKEN?: string;
  MCP_API_KEY?: string;
  SLACK_MCP_ADD_MESSAGE_TOOL?: string;
};

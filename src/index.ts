import { McpServer } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { createMcpHandler } from 'agents/mcp/server';

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

/**
 * Creates a fresh McpServer per request (createMcpHandler is stateless).
 * Tools are registered in later tasks; this is the minimal skeleton.
 *
 * CfWorkerJsonSchemaValidator is required on Workers: the default Ajv
 * validator relies on `new Function`, which is unavailable in workerd.
 */
function createServer(): McpServer {
  return new McpServer(
    { name: 'slackrabbit', version: '0.1.0' },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
}

const handler = createMcpHandler(() => createServer());

/**
 * Constant-time string comparison (equivalent of Go's
 * `subtle.ConstantTimeCompare`). Length mismatch returns early because the
 * length itself is not secret.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/**
 * Validates `Authorization: Bearer <MCP_API_KEY>`.
 *
 * When MCP_API_KEY is unset the check is skipped (mirrors the upstream Go
 * server; intended for local development only). wrangler.jsonc lists
 * MCP_API_KEY under `secrets.required` so `wrangler dev` warns when it is
 * missing; always set it for deployed environments.
 */
function checkBearer(request: Request, key: string | undefined): boolean {
  if (!key) return true;
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;
  return timingSafeEqual(token, key);
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!checkBearer(request, env.MCP_API_KEY)) {
      return Promise.resolve(
        new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer' },
        }),
      );
    }
    return handler(request, env, ctx);
  },
};

import { createMcpHandler } from 'agents/mcp/server';
import { checkBearer } from './auth';
import { loadConfig } from './config';
import type { Env } from './env';
import { createServer } from './mcp';

// NOTE: this module is the Workers entry point. Only the default export may
// live here — workerd treats every named export as a handler/Durable Object
// and rejects anything else. Helpers belong in ./auth, ./mcp, etc.

/** Route served by the MCP handler (Streamable HTTP). */
const MCP_ROUTE = '/mcp';

/**
 * Worker entry. Order is fixed: load config → Bearer auth → MCP handler.
 *
 * - Config errors (no Slack token, mixed allow/deny post policy) surface as a
 *   500 with the reason in the body and are logged; they are never swallowed.
 * - Auth runs before the MCP layer so unauthenticated callers never see the
 *   tool list.
 * - `createMcpHandler` is stateless: the factory builds a fresh McpServer per
 *   request. No Durable Objects are involved.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let cfg;
    try {
      cfg = loadConfig(env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`slackrabbit: invalid configuration: ${message}`);
      return new Response(`Invalid configuration: ${message}`, { status: 500 });
    }

    if (!checkBearer(request, cfg.mcpApiKey)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    const handler = createMcpHandler(() => createServer(cfg, env.SLACK_CACHE), {
      route: MCP_ROUTE,
    });
    return handler(request, env, ctx);
  },
};

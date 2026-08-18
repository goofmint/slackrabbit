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

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler(request, env, ctx);
  },
};

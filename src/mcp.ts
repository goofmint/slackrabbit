import { McpServer } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import type { Config } from './config';
import { SlackClient } from './slack/client';
import { registerAddMessage } from './tools/addMessage';
import { registerChannelsList } from './tools/channels';
import { registerConversationsHistory, registerConversationsReplies } from './tools/conversations';
import { registerSearchMessages } from './tools/search';
import { registerUsersSearch } from './tools/users';

export const SERVER_NAME = 'slackrabbit';
export const SERVER_VERSION = '0.1.0';

/**
 * Builds a fresh `McpServer` for one request (createMcpHandler is stateless,
 * so this factory runs per request) and registers tools according to the
 * resolved configuration.
 *
 * Registration matrix (decided here, at construction time, so unusable tools
 * never appear in `tools/list`):
 *
 * | tool                          | condition                                  |
 * |-------------------------------|--------------------------------------------|
 * | channels_list                 | always                                     |
 * | conversations_history         | always                                     |
 * | conversations_replies         | always                                     |
 * | users_search                  | always                                     |
 * | conversations_search_messages | `cfg.searchEnabled` (user token present)   |
 * | conversations_add_message     | `cfg.addMessagePolicy.kind !== 'disabled'` |
 *
 * `CfWorkerJsonSchemaValidator` is mandatory on Workers: the SDK's default
 * Ajv validator relies on `new Function`, which workerd does not allow.
 */
export function createServer(cfg: Config, kv: KVNamespace): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  const client = new SlackClient(cfg);

  registerChannelsList(server, client, kv);
  registerConversationsHistory(server, client, kv);
  registerConversationsReplies(server, client, kv);
  registerUsersSearch(server, client, kv);

  if (cfg.searchEnabled) {
    registerSearchMessages(server, client, kv);
  }
  if (cfg.addMessagePolicy.kind !== 'disabled') {
    registerAddMessage(server, client, kv, cfg.addMessagePolicy);
  }

  return server;
}

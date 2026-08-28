# slackrabbit

Slack MCP server on Cloudflare Workers, built for [CodeRabbit](https://www.coderabbit.ai/) integration: it feeds Slack context into code reviews and can post review summaries back to Slack.

- Streamable HTTP MCP endpoint at `/mcp` (stateless, no Durable Objects)
- Tools: `channels_list`, `conversations_history`, `conversations_replies`, `users_search`, `conversations_search_messages` (user token only), `conversations_add_message` (guarded, disabled by default)
- Bearer auth (`MCP_API_KEY`), Workers KV cache for users/channels

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in real tokens
npm run dev                      # wrangler dev → http://localhost:8787/mcp
```

Verify locally (works without real tokens; does more with them):

```bash
bash scripts/verify-local.sh
```

Deploy:

```bash
npx wrangler login
bash scripts/deploy.sh
```

Full setup, verification, CodeRabbit registration, and end-to-end testing steps: **[docs/setup.md](docs/setup.md)**.

#!/usr/bin/env bash
# Deploy helper for issue #19 (secrets + wrangler deploy).
#
# Everything that needs YOUR credentials happens interactively in this
# script — tokens are typed by you into wrangler's own prompts and are
# never stored in the repository.
#
# Prerequisites:
#   1. `npx wrangler login` (opens a browser; must be run by a human)
#   2. Slack tokens at hand (xoxp and/or xoxb; both recommended)
#
# Usage: bash scripts/deploy.sh
set -euo pipefail

say() { printf '%s\n' "$*"; }

say "== 1/4 Cloudflare auth check =="
if ! npx wrangler whoami >/dev/null 2>&1; then
  say "Not logged in. Run:  npx wrangler login"
  exit 1
fi
npx wrangler whoami | head -5

say ""
say "== 2/4 Secrets =="
say "Each 'wrangler secret put' prompts for the value interactively."
say "MCP_API_KEY should be a long random string, e.g.:  openssl rand -hex 32"
for name in MCP_API_KEY SLACK_XOXP_TOKEN SLACK_XOXB_TOKEN; do
  printf 'Set %s now? [y/N] ' "${name}"
  read -r answer
  if [ "${answer}" = "y" ] || [ "${answer}" = "Y" ]; then
    npx wrangler secret put "${name}"
  else
    say "  skipped ${name}"
  fi
done
say "(At least one Slack token is required; the Worker returns 500 otherwise.)"

say ""
say "== 3/4 Post guard reminder =="
say "wrangler.jsonc vars.SLACK_MCP_ADD_MESSAGE_TOOL is currently:"
grep -o '"SLACK_MCP_ADD_MESSAGE_TOOL": *"[^"]*"' wrangler.jsonc || true
say "For production use an explicit channel allow-list (e.g. \"C0123456789\"),"
say "not \"true\". Edit wrangler.jsonc before deploying if needed."

say ""
say "== 4/4 Deploy =="
npx wrangler deploy

say ""
say "Post-deploy check (expects 401 because no Authorization header is sent):"
url="$(npx wrangler deployments list 2>/dev/null | grep -o 'https://[^ ]*workers.dev' | head -1 || true)"
if [ -n "${url}" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${url}/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
  say "POST ${url}/mcp -> ${code} (expected 401 when MCP_API_KEY is set)"
else
  say "Could not detect the workers.dev URL automatically; test manually:"
  say "  curl -X POST https://slackrabbit.<your-subdomain>.workers.dev/mcp ..."
fi

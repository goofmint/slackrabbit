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
# Usage:
#   bash scripts/deploy.sh
#   WORKER_URL=https://slackrabbit.example.workers.dev bash scripts/deploy.sh
#
# The script FAILS (non-zero exit) when:
#   - not logged in to Cloudflare
#   - MCP_API_KEY is neither already set nor set during this run
#   - the deployed URL cannot be determined (set WORKER_URL to override)
#   - the unauthenticated post-deploy probe does not return 401
set -euo pipefail

say() { printf '%s\n' "$*"; }
die() { say "ERROR: $*"; exit 1; }

say "== 1/4 Cloudflare auth check =="
npx wrangler whoami >/dev/null 2>&1 || die "Not logged in. Run:  npx wrangler login"
npx wrangler whoami | head -5

say ""
say "== 2/4 Secrets =="
say "Each 'wrangler secret put' prompts for the value interactively."
say "MCP_API_KEY should be a long random string, e.g.:  openssl rand -hex 32"

existing_secrets="$(npx wrangler secret list 2>/dev/null || true)"
has_secret() { printf '%s' "${existing_secrets}" | grep -q "\"${1}\""; }

# MCP_API_KEY is mandatory: without it the Worker serves /mcp with NO auth.
if has_secret MCP_API_KEY; then
  say "MCP_API_KEY: already set."
  printf 'Rotate it now? [y/N] '
  read -r answer
  [ "${answer}" = "y" ] || [ "${answer}" = "Y" ] && npx wrangler secret put MCP_API_KEY
else
  say "MCP_API_KEY is REQUIRED (an unset key disables authentication)."
  npx wrangler secret put MCP_API_KEY || die "MCP_API_KEY was not set; aborting."
fi

# Slack tokens: at least one required by the Worker; both recommended.
for name in SLACK_XOXP_TOKEN SLACK_XOXB_TOKEN; do
  if has_secret "${name}"; then
    say "${name}: already set (skip)."
    continue
  fi
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
deploy_out="$(npx wrangler deploy 2>&1)" || { printf '%s\n' "${deploy_out}"; die "wrangler deploy failed"; }
printf '%s\n' "${deploy_out}"

say ""
say "== Post-deploy gate (unauthenticated probe must return 401) =="
url="${WORKER_URL:-}"
if [ -z "${url}" ]; then
  # `wrangler deploy` prints the deployed URL; parse it from the output we
  # just captured rather than relying on `deployments list` formatting.
  url="$(printf '%s\n' "${deploy_out}" | grep -o 'https://[a-zA-Z0-9.-]*workers\.dev' | head -1 || true)"
fi
[ -n "${url}" ] || die "Could not determine the Worker URL. Re-run with WORKER_URL=https://... bash scripts/deploy.sh"

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${url}/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
say "POST ${url}/mcp (no auth) -> ${code}"
[ "${code}" = "401" ] || die "Expected 401 for an unauthenticated request; got ${code}. Check that MCP_API_KEY is set (wrangler secret list)."
say "OK: endpoint is deployed and protected."

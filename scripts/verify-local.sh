#!/usr/bin/env bash
# Local verification harness for issues #15 (MCP handshake), #16 (token
# gating), and #17 (post guard).
#
# Two modes:
#   - Offline mode (default): runs every check that does NOT need a real
#     Slack workspace, using fake tokens. Covers the tools/list matrix,
#     Bearer auth, and the mixed-policy startup error.
#   - Live mode: when .dev.vars contains real tokens (values not starting
#     with "xoxp-your-" / "xoxb-your-"), additionally exercises real API
#     calls (channels_list CSV, users_search CSV, search with xoxp) and,
#     when ALLOWED_CHANNEL / DENIED_CHANNEL are exported, the post-guard
#     allow/deny behavior against the real workspace.
#
# Usage:
#   bash scripts/verify-local.sh                  # offline checks
#   ALLOWED_CHANNEL=C0123 DENIED_CHANNEL=C0456 \
#   bash scripts/verify-local.sh                  # + live post-guard checks
#
# The user's .dev.vars is backed up and restored on exit.
set -u

PORT="${PORT:-8931}"
KEY="verify-key-$$"
BASE="http://localhost:${PORT}/mcp"
LOG="$(mktemp)"
PASS=0
FAIL=0
DEV_VARS_BACKUP=""

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); say "  ✅ $*"; }
bad()  { FAIL=$((FAIL + 1)); say "  ❌ $*"; }

cleanup() {
  pkill -f "wrangler dev --port ${PORT}" 2>/dev/null
  if [ -n "${DEV_VARS_BACKUP}" ] && [ -f "${DEV_VARS_BACKUP}" ]; then
    mv "${DEV_VARS_BACKUP}" .dev.vars
  elif [ -f .dev.vars.verify-active ]; then
    rm -f .dev.vars
  fi
  rm -f .dev.vars.verify-active "${LOG}"
}
trap cleanup EXIT

if [ -f .dev.vars ]; then
  DEV_VARS_BACKUP="$(mktemp)"
  cp .dev.vars "${DEV_VARS_BACKUP}"
fi

start_dev() { # $1 = .dev.vars content
  pkill -f "wrangler dev --port ${PORT}" 2>/dev/null
  sleep 1
  printf '%s\n' "$1" > .dev.vars
  : > .dev.vars.verify-active
  : > "${LOG}"
  (npx wrangler dev --port "${PORT}" > "${LOG}" 2>&1 &)
  for _ in $(seq 1 60); do
    grep -q "Ready on" "${LOG}" && return 0
    sleep 1
  done
  return 1
}

# Status and body are fetched with separate requests: the response body can
# be multi-line (SSE framing), which makes single-call status extraction
# fragile. Every endpoint here is a read, so the extra request is harmless.
rpc_status() { # $1 = auth header value or "", $2 = JSON body
  local auth=()
  [ -n "$1" ] && auth=(-H "Authorization: $1")
  curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    "${auth[@]}" -d "$2"
}

rpc_body() { # $1 = auth header value or "", $2 = JSON body
  local auth=()
  [ -n "$1" ] && auth=(-H "Authorization: $1")
  curl -s -X POST "${BASE}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    "${auth[@]}" -d "$2"
}

LIST='{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

tool_names() { # prints sorted tool names from a tools/list response body
  printf '%s' "$1" | grep -o '"name":"[a-z_]*"' | sed 's/"name":"//;s/"//' | sort | tr '\n' ' '
}

call_tool_body() { # $1 tool, $2 arguments JSON; prints the response body
  rpc_body "Bearer ${KEY}" \
    "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}"
}

# ---------------------------------------------------------------- offline ----
say "== #16: tools/list matrix (fake tokens) =="

if start_dev "MCP_API_KEY=${KEY}
SLACK_XOXB_TOKEN=xoxb-fake"; then
  names="$(tool_names "$(rpc_body "Bearer ${KEY}" "${LIST}")")"
  exp="channels_list conversations_history conversations_replies users_search "
  [ "${names}" = "${exp}" ] \
    && ok "xoxb only: read tools only (no search, no add_message)" \
    || bad "xoxb only: got [${names}]"
else bad "wrangler dev failed to boot (xoxb only)"; fi

if start_dev "MCP_API_KEY=${KEY}
SLACK_XOXP_TOKEN=xoxp-fake
SLACK_XOXB_TOKEN=xoxb-fake
SLACK_MCP_ADD_MESSAGE_TOOL=C0000000000"; then
  names="$(tool_names "$(rpc_body "Bearer ${KEY}" "${LIST}")")"
  case "${names}" in
    *conversations_search_messages*) ok "both tokens: search tool present";;
    *) bad "both tokens: search tool missing [${names}]";;
  esac
  case "${names}" in
    *conversations_add_message*) ok "allow-list policy: add_message present";;
    *) bad "allow-list policy: add_message missing [${names}]";;
  esac
else bad "wrangler dev failed to boot (both tokens)"; fi

say "== config errors =="
if start_dev "MCP_API_KEY=${KEY}
SLACK_XOXP_TOKEN=xoxp-fake
SLACK_MCP_ADD_MESSAGE_TOOL=C1,!C2"; then
  st="$(rpc_status "Bearer ${KEY}" "${LIST}")"
  if [ "${st}" = "500" ] && rpc_body "Bearer ${KEY}" "${LIST}" | grep -q "cannot mix"; then
    ok "mixed allow/deny policy → 500 with reason"
  else
    bad "mixed policy: expected 500/cannot mix, got ${st}"
  fi
else bad "wrangler dev failed to boot (mixed policy)"; fi

say "== #15/#18: Bearer auth =="
if start_dev "MCP_API_KEY=${KEY}
SLACK_XOXB_TOKEN=xoxb-fake"; then
  [ "$(rpc_status "" "${LIST}")" = "401" ]              && ok "no auth → 401"     || bad "no auth"
  [ "$(rpc_status "Bearer wrong" "${LIST}")" = "401" ]  && ok "wrong key → 401"   || bad "wrong key"
  [ "$(rpc_status "${KEY}" "${LIST}")" = "401" ]        && ok "bare key → 401"    || bad "bare key"
  [ "$(rpc_status "Bearer ${KEY}" "${LIST}")" = "200" ] && ok "correct key → 200" || bad "correct key"
else bad "wrangler dev failed to boot (auth)"; fi

# ------------------------------------------------------------------- live ----
XOXP=""; XOXB=""
if [ -n "${DEV_VARS_BACKUP}" ]; then
  XOXP="$(grep -E '^SLACK_XOXP_TOKEN=' "${DEV_VARS_BACKUP}" | cut -d= -f2- || true)"
  XOXB="$(grep -E '^SLACK_XOXB_TOKEN=' "${DEV_VARS_BACKUP}" | cut -d= -f2- || true)"
fi
is_real() { case "$1" in xoxp-your-*|xoxb-your-*|"") return 1;; xoxp-*|xoxb-*) return 0;; *) return 1;; esac; }

if is_real "${XOXP}" || is_real "${XOXB}"; then
  say "== live checks (real tokens found in .dev.vars) =="
  policy="${ALLOWED_CHANNEL:-}"
  live_vars="MCP_API_KEY=${KEY}"
  is_real "${XOXP}" && live_vars="${live_vars}
SLACK_XOXP_TOKEN=${XOXP}"
  is_real "${XOXB}" && live_vars="${live_vars}
SLACK_XOXB_TOKEN=${XOXB}"
  [ -n "${policy}" ] && live_vars="${live_vars}
SLACK_MCP_ADD_MESSAGE_TOOL=${policy}"

  if start_dev "${live_vars}"; then
    b="$(call_tool_body channels_list '{"limit":5}')"
    printf '%s' "${b}" | grep -q 'ID,Name,Topic' && ok "#15 channels_list returns CSV" || bad "#15 channels_list: $(printf '%s' "${b}" | head -c 200)"

    b="$(call_tool_body users_search '{"limit":5}')"
    printf '%s' "${b}" | grep -q 'UserID,UserName' && ok "#15 users_search returns CSV" || bad "#15 users_search"

    if is_real "${XOXP}"; then
      b="$(call_tool_body conversations_search_messages '{"query":"the","count":3}')"
      printf '%s' "${b}" | grep -q 'MsgID,UserID' && ok "#16 search succeeds with xoxp" || bad "#16 search: $(printf '%s' "${b}" | head -c 200)"
    fi

    if [ -n "${ALLOWED_CHANNEL:-}" ] && [ -n "${DENIED_CHANNEL:-}" ]; then
      b="$(call_tool_body conversations_add_message "{\"channel_id\":\"${ALLOWED_CHANNEL}\",\"text\":\"slackrabbit verify: allowed channel post\"}")"
      printf '%s' "${b}" | grep -q 'Successfully posted' && ok "#17 allowed channel: posted" || bad "#17 allowed channel: $(printf '%s' "${b}" | head -c 200)"

      b="$(call_tool_body conversations_add_message "{\"channel_id\":\"${DENIED_CHANNEL}\",\"text\":\"should never appear\"}")"
      printf '%s' "${b}" | grep -q 'not allowed by SLACK_MCP_ADD_MESSAGE_TOOL' && ok "#17 denied channel (ID) rejected" || bad "#17 denied by ID"

      if [ -n "${DENIED_CHANNEL_NAME:-}" ]; then
        b="$(call_tool_body conversations_add_message "{\"channel_id\":\"${DENIED_CHANNEL_NAME}\",\"text\":\"should never appear\"}")"
        printf '%s' "${b}" | grep -q 'not allowed by SLACK_MCP_ADD_MESSAGE_TOOL' && ok "#17 denied channel (#name) rejected" || bad "#17 denied by #name"
      fi
    else
      say "  (post-guard live checks skipped: export ALLOWED_CHANNEL / DENIED_CHANNEL [/ DENIED_CHANNEL_NAME])"
    fi
  else bad "wrangler dev failed to boot (live)"; fi
else
  say "== live checks skipped: no real tokens in .dev.vars =="
  say "   (copy .dev.vars.example to .dev.vars and fill in real xoxp/xoxb tokens)"
fi

say ""
say "RESULT: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ]

/**
 * Post policy guard, ported from the Go `korotovsky/slack-mcp-server` project.
 *
 * Controls whether the "post message" tool is allowed to post into a given
 * Slack channel, based on the `SLACK_MCP_ADD_MESSAGE_TOOL` environment
 * variable.
 */

/**
 * The parsed form of `SLACK_MCP_ADD_MESSAGE_TOOL`.
 *
 * - `disabled`: posting is not allowed anywhere (the tool should not be
 *   registered / should refuse all requests).
 * - `all`: posting is allowed in any channel.
 * - `allow`: posting is allowed only in the listed channels.
 * - `deny`: posting is allowed everywhere except the listed channels.
 */
export type PostPolicy =
  | { kind: 'disabled' }
  | { kind: 'all' }
  | { kind: 'allow'; channels: Set<string> }
  | { kind: 'deny'; channels: Set<string> };

/**
 * Parses the `SLACK_MCP_ADD_MESSAGE_TOOL` environment variable into a
 * {@link PostPolicy}.
 *
 * Rules:
 * - `undefined` or an empty/whitespace-only string disables posting.
 * - `"true"` or `"1"` (after trimming) allows posting in every channel.
 * - Otherwise the value is treated as a comma-separated list of channel
 *   IDs. Entries prefixed with `!` are treated as a deny-list entry (the
 *   `!` is stripped); entries without the prefix are allow-list entries.
 *   Whitespace around each entry is trimmed, and empty entries are
 *   dropped.
 * - Mixing allow entries and deny entries in the same value is invalid
 *   and throws an `Error`.
 * - If no entries remain after filtering, posting is disabled.
 *
 * @param raw The raw value of `SLACK_MCP_ADD_MESSAGE_TOOL`.
 */
export function parsePostPolicy(raw: string | undefined): PostPolicy {
  const trimmed = raw?.trim();

  if (trimmed === undefined || trimmed === '') {
    return { kind: 'disabled' };
  }

  if (trimmed === 'true' || trimmed === '1') {
    return { kind: 'all' };
  }

  const allowChannels = new Set<string>();
  const denyChannels = new Set<string>();

  for (const rawEntry of trimmed.split(',')) {
    const entry = rawEntry.trim();
    if (entry === '') {
      continue;
    }

    if (entry.startsWith('!')) {
      const channel = entry.slice(1);
      if (channel !== '') {
        denyChannels.add(channel);
      }
    } else {
      allowChannels.add(entry);
    }
  }

  if (allowChannels.size > 0 && denyChannels.size > 0) {
    throw new Error('cannot mix allowed and disallowed (! prefixed) channels');
  }

  if (denyChannels.size > 0) {
    return { kind: 'deny', channels: denyChannels };
  }

  if (allowChannels.size > 0) {
    return { kind: 'allow', channels: allowChannels };
  }

  return { kind: 'disabled' };
}

/**
 * Determines whether posting is allowed into a channel under the given
 * policy.
 *
 * IMPORTANT: `resolvedChannelId` MUST be an already-resolved Slack
 * channel ID (e.g. `"C0123456789"`), never a human-readable name such as
 * `"#general"` or a user reference such as `"@user"`. Callers (e.g. the
 * T-12 add-message tool) must call `resolveChannelId()` first and pass
 * the resolved ID here. Passing an unresolved name/notation can bypass
 * an `allow`/`deny` list, since the policy only ever compares against
 * resolved IDs.
 */
export function isChannelAllowed(policy: PostPolicy, resolvedChannelId: string): boolean {
  switch (policy.kind) {
    case 'disabled':
      return false;
    case 'all':
      return true;
    case 'allow':
      return policy.channels.has(resolvedChannelId);
    case 'deny':
      return !policy.channels.has(resolvedChannelId);
  }
}

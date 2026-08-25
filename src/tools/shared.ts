import type { CallToolResult } from '@modelcontextprotocol/server';
import { toCsv } from '../format/csv';
import type { UsersCache } from '../slack/cache';
import type { SlackMessage } from '../slack/types';

/** CSV header order for message-shaped tool output (matches the Go server). */
export const MESSAGE_HEADERS = [
  'MsgID',
  'UserID',
  'UserName',
  'RealName',
  'Channel',
  'ThreadTs',
  'Text',
  'Time',
  'Permalink',
  'Cursor',
] as const;

/** CSV header order for `channels_list`. */
export const CHANNEL_HEADERS = ['ID', 'Name', 'Topic', 'Purpose', 'MemberCount', 'Cursor'] as const;

/** CSV header order for `users_search`. */
export const USER_HEADERS = [
  'UserID',
  'UserName',
  'RealName',
  'DisplayName',
  'Email',
  'Title',
  'DMChannelID',
] as const;

/** A single CSV row: header name → cell value. */
export type Row = Record<string, string | number | boolean | undefined>;

/**
 * Converts a Slack `ts` (seconds with microsecond fraction, e.g.
 * `1700000000.123456`) into an ISO 8601 / RFC 3339 UTC timestamp.
 * Returns the raw input when it cannot be parsed.
 */
export function slackTsToIso(ts: string): string {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return ts;
  return new Date(Math.floor(seconds * 1000)).toISOString();
}

/**
 * Looks up display names for a Slack user ID from the users cache.
 * Unknown IDs (deleted users, external accounts) yield empty strings.
 */
export function resolveUserNames(
  users: UsersCache,
  userId: string | undefined,
): { userName: string; realName: string } {
  if (!userId) return { userName: '', realName: '' };
  const u = users.byId[userId];
  if (!u) return { userName: '', realName: '' };
  return {
    userName: u.name,
    realName: u.real_name ?? u.profile?.real_name ?? '',
  };
}

/**
 * Builds one message row in {@link MESSAGE_HEADERS} order.
 *
 * `Permalink` is filled only when Slack supplied one (search results do;
 * `conversations.history` / `conversations.replies` do not — this mirrors
 * the Go server, which leaves it empty rather than calling
 * `chat.getPermalink` per message).
 */
export function messageRow(
  msg: SlackMessage,
  channel: string,
  users: UsersCache,
): Row {
  const { userName, realName } = resolveUserNames(users, msg.user);
  return {
    MsgID: msg.ts,
    UserID: msg.user ?? '',
    UserName: userName || msg.username || '',
    RealName: realName,
    Channel: channel,
    ThreadTs: msg.thread_ts ?? '',
    Text: msg.text ?? '',
    Time: slackTsToIso(msg.ts),
    Permalink: msg.permalink ?? '',
    Cursor: '',
  };
}

/**
 * Channel-lifecycle `subtype`s that count as activity noise. Only these are
 * dropped by {@link filterActivity}; content-bearing subtypes such as
 * `bot_message`, `file_share`, `thread_broadcast`, or `me_message` are
 * regular posts and must be kept.
 */
export const ACTIVITY_SUBTYPES: ReadonlySet<string> = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
  'group_topic',
  'group_purpose',
  'group_name',
  'group_archive',
  'group_unarchive',
]);

/**
 * Filters out activity messages (`channel_join`, `channel_leave`, …) unless
 * the caller asked to include them. Only subtypes in
 * {@link ACTIVITY_SUBTYPES} are removed — messages with other subtypes
 * (`bot_message`, `file_share`, …) are ordinary content and pass through.
 */
export function filterActivity(messages: SlackMessage[], includeActivity: boolean): SlackMessage[] {
  if (includeActivity) return messages;
  return messages.filter((m) => m.subtype === undefined || !ACTIVITY_SUBTYPES.has(m.subtype));
}

/**
 * Sets the `Cursor` cell of the LAST row to `nextCursor` (pagination
 * contract: the client passes it back as the `cursor` parameter).
 *
 * When every row of a page was filtered out but Slack still returned a
 * cursor, a cursor-only row (all other cells empty) is appended so the
 * caller can keep paginating instead of silently losing the rest of the
 * conversation. No-op on an empty cursor. Mutates and returns `rows`.
 */
export function withCursor(rows: Row[], nextCursor: string | undefined): Row[] {
  if (!nextCursor) return rows;
  if (rows.length === 0) {
    rows.push({ Cursor: nextCursor });
    return rows;
  }
  const last = rows[rows.length - 1];
  if (last) last.Cursor = nextCursor;
  return rows;
}

/** Wraps a CSV table as an MCP text tool result. */
export function csvResult(headers: readonly string[], rows: Row[]): CallToolResult {
  return {
    content: [{ type: 'text', text: toCsv([...headers], rows) }],
  };
}

/** Clamps a numeric option into `[min, max]`, using `def` when undefined. */
export function clampInt(value: number | undefined, def: number, min: number, max: number): number {
  const v = value === undefined ? def : Math.trunc(value);
  return Math.min(max, Math.max(min, v));
}

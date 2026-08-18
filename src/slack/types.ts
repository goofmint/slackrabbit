/**
 * Shared Slack Web API types used by {@link SlackClient} and downstream
 * consumers (e.g. the T-09 cache layer).
 */

/**
 * The shape every Slack Web API response follows: either `ok: true` plus
 * the method-specific payload `T`, or `ok: false` with an `error` code.
 */
export type SlackResponse<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Cursor-based pagination metadata included in paginated Slack responses.
 */
export type SlackPaging = { response_metadata?: { next_cursor?: string } };

/** A single Slack message, as returned by conversations.* and search.messages. */
export type SlackMessage = {
  ts: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text?: string;
  thread_ts?: string;
  subtype?: string;
  permalink?: string;
};

/** A Slack channel (public, private, or IM), as returned by conversations.list. */
export type SlackChannel = {
  id: string;
  name?: string;
  is_im?: boolean;
  user?: string;
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
};

/** A Slack user/member, as returned by users.list. */
export type SlackUser = {
  id: string;
  name: string;
  real_name?: string;
  deleted?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
    title?: string;
  };
};

import type { Config } from '../config';
import type {
  SlackChannel,
  SlackMessage,
  SlackPaging,
  SlackResponse,
  SlackUser,
} from './types';

/** Parameters for `conversations.list`. */
export type ConversationsListParams = {
  types?: string;
  limit?: number;
  cursor?: string;
  exclude_archived?: boolean;
};

/** Result of `conversations.list`. */
export type ConversationsListResult = SlackPaging & { channels: SlackChannel[] };

/** Parameters for `conversations.history`. */
export type ConversationsHistoryParams = {
  channel: string;
  limit?: number;
  cursor?: string;
  oldest?: string;
  latest?: string;
  inclusive?: boolean;
};

/** Result of `conversations.history`. */
export type ConversationsHistoryResult = SlackPaging & {
  messages: SlackMessage[];
  has_more?: boolean;
};

/** Parameters for `conversations.replies`. */
export type ConversationsRepliesParams = {
  channel: string;
  ts: string;
  limit?: number;
  cursor?: string;
};

/** Result of `conversations.replies`. */
export type ConversationsRepliesResult = SlackPaging & {
  messages: SlackMessage[];
  has_more?: boolean;
};

/** Parameters for `search.messages`. */
export type SearchMessagesParams = {
  query: string;
  count?: number;
  page?: number;
  sort?: 'score' | 'timestamp';
  sort_dir?: 'asc' | 'desc';
};

/** Result of `search.messages`. */
export type SearchMessagesResult = {
  messages: {
    matches: Array<SlackMessage & { channel?: { id: string; name?: string } }>;
    paging?: { count?: number; total?: number; page?: number; pages?: number };
    pagination?: Record<string, unknown>;
  };
};

/** Parameters for `users.list`. */
export type UsersListParams = { limit?: number; cursor?: string };

/** Result of `users.list`. */
export type UsersListResult = SlackPaging & { members: SlackUser[] };

/** Parameters for `chat.postMessage`. */
export type PostMessageParams = {
  channel: string;
  text: string;
  thread_ts?: string;
  mrkdwn?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
};

/** Result of `chat.postMessage`. */
export type PostMessageResult = {
  channel: string;
  ts: string;
  message?: Record<string, unknown>;
};

/** Params object accepted by {@link SlackClient.request}: a flat record of primitives. */
type RequestParams = Record<string, string | number | boolean | undefined>;

/** Optional overrides for the fetch and sleep primitives, used by tests. */
export type SlackClientOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const SLACK_API_BASE = 'https://slack.com/api';
const MAX_RETRIES = 2;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin wrapper around the Slack Web API methods this project needs.
 *
 * Handles token routing (bot vs. user token per method), request encoding
 * (GET query string vs. POST JSON body), `ok: false` error surfacing, and
 * `429` rate-limit retries with `Retry-After` back-off.
 */
export class SlackClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly cfg: Config,
    options?: SlackClientOptions,
  ) {
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    this.sleep = options?.sleep ?? defaultSleep;
  }

  conversationsList(params: ConversationsListParams = {}): Promise<ConversationsListResult> {
    return this.request<ConversationsListResult>(
      'conversations.list',
      this.cfg.readToken,
      'GET',
      params,
    );
  }

  conversationsHistory(
    params: ConversationsHistoryParams,
  ): Promise<ConversationsHistoryResult> {
    return this.request<ConversationsHistoryResult>(
      'conversations.history',
      this.cfg.readToken,
      'GET',
      params,
    );
  }

  conversationsReplies(
    params: ConversationsRepliesParams,
  ): Promise<ConversationsRepliesResult> {
    return this.request<ConversationsRepliesResult>(
      'conversations.replies',
      this.cfg.readToken,
      'GET',
      params,
    );
  }

  usersList(params: UsersListParams = {}): Promise<UsersListResult> {
    return this.request<UsersListResult>('users.list', this.cfg.readToken, 'GET', params);
  }

  async searchMessages(params: SearchMessagesParams): Promise<SearchMessagesResult> {
    if (this.cfg.xoxp === undefined) {
      // Rejected promise (not a sync throw) so callers can rely on a single
      // async error path. Checked before any network call.
      throw new Error('search.messages requires a user token (SLACK_XOXP_TOKEN)');
    }
    return this.request<SearchMessagesResult>(
      'search.messages',
      this.cfg.xoxp,
      'GET',
      params,
    );
  }

  postMessage(params: PostMessageParams): Promise<PostMessageResult> {
    return this.request<PostMessageResult>(
      'chat.postMessage',
      this.cfg.postToken,
      'POST',
      params,
    );
  }

  /**
   * Performs a single Slack Web API call, handling encoding, auth, `429`
   * retries (up to {@link MAX_RETRIES} additional attempts), and error
   * surfacing (`ok: false` payloads and non-2xx HTTP statuses).
   *
   * Never logs the token.
   */
  private async request<T>(
    method: string,
    token: string,
    httpMethod: 'GET' | 'POST',
    params: RequestParams,
  ): Promise<T> {
    const url = new URL(`${SLACK_API_BASE}/${method}`);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    let body: string | undefined;

    if (httpMethod === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    } else {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      const bodyParams: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) {
          continue;
        }
        bodyParams[key] = value;
      }
      body = JSON.stringify(bodyParams);
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await this.fetchImpl(url.toString(), {
        method: httpMethod,
        headers,
        body,
      });

      if (response.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const retryAfterSeconds = Number(retryAfterHeader);
          const waitSeconds =
            retryAfterHeader === null || Number.isNaN(retryAfterSeconds) ? 1 : retryAfterSeconds;
          await this.sleep(waitSeconds * 1000);
          continue;
        }
        throw new Error(`Slack API ${method} rate limited`);
      }

      if (!response.ok) {
        throw new Error(`Slack API ${method} failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as SlackResponse<T>;
      if (data.ok === false) {
        throw new Error(`Slack API ${method} failed: ${data.error}`);
      }

      const { ok: _ok, ...rest } = data;
      return rest as T;
    }

    // Unreachable: the loop above always returns or throws.
    throw new Error(`Slack API ${method} rate limited`);
  }
}

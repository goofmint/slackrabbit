# セットアップと検証の手順

実装済みの Worker を、ローカル検証 → デプロイ → CodeRabbit 連携まで進めるための手順書。
コード側の準備はすべて完了しており、以下の操作は認証情報を持つ人だけが実行できる。

## 1. ローカル検証（Issue #15 / #16 / #17）

```bash
cp .dev.vars.example .dev.vars
# .dev.vars を編集して実トークンを記入（このファイルは gitignore 済み）
```

必要な Slack スコープ:

| トークン | スコープ |
|---|---|
| xoxp（ユーザー） | `channels:history`, `groups:history`, `im:history`, `mpim:history`, `channels:read`, `groups:read`, `users:read`, `search:read`, `chat:write` |
| xoxb（ボット） | `channels:history`, `groups:history`, `channels:read`, `groups:read`, `users:read`, `chat:write` |

検証ハーネスを実行する:

```bash
bash scripts/verify-local.sh
```

- トークンなし → オフライン検証のみ（tools/list の出し分け、Bearer 認証、設定エラー）
- 実トークンあり → 上記に加えて実 API 検証（channels_list / users_search / search の CSV）
- 投稿ガードの実地検証はテスト用チャンネルを 2 つ用意して:

```bash
ALLOWED_CHANNEL=C許可チャンネルID DENIED_CHANNEL=C拒否チャンネルID DENIED_CHANNEL_NAME='#拒否チャンネル名' bash scripts/verify-local.sh
```

`#name` 表記の拒否が通ることが最重要の確認項目（ID 解決後にガード判定している証明）。

MCP Inspector で対話的に確認する場合:

```bash
npx wrangler dev
```

```bash
npx @modelcontextprotocol/inspector
```

Transport = Streamable HTTP、URL = `http://localhost:8787/mcp`、Header = `Authorization: Bearer <MCP_API_KEY>`。

## 2. デプロイ（Issue #19）

```bash
npx wrangler login
```

```bash
bash scripts/deploy.sh
```

スクリプトが対話的に行うこと: ログイン確認 → `wrangler secret put`（MCP_API_KEY / SLACK_XOXP_TOKEN / SLACK_XOXB_TOKEN、値は wrangler のプロンプトに直接入力）→ 投稿ガード設定の確認 → `wrangler deploy` → デプロイ先 URL の 401 疎通確認。

- KV namespace は draft binding のため初回デプロイ時に自動プロビジョニングされる（事前作成不要）
- 本番の `SLACK_MCP_ADD_MESSAGE_TOOL` は `true` ではなく**チャンネル ID の許可リスト**にする

## 3. CodeRabbit への登録（Issue #20）

CodeRabbit ダッシュボード → Integrations → New MCP Server:

| 項目 | 値 |
|---|---|
| Name | `slackrabbit` |
| URL | `https://slackrabbit.<your-subdomain>.workers.dev/mcp` |
| 認証 | API token（`MCP_API_KEY` の値） |

トランスポートは Streamable HTTP。CodeRabbit は公式に "Streamable HTTP and SSE transports both work" と明記しており（[docs](https://docs.coderabbit.ai/integrations/mcp-servers)）、`/sse` エンドポイントは不要。

接続に失敗した場合の切り分け:
1. MCP Inspector から本番 URL に接続できるか（できれば Worker は正常）
2. 401 なら認証設定、それ以外はトランスポート
3. `npx wrangler tail` で CodeRabbit からのリクエストが届いているか

## 4. エンドツーエンド確認（Issue #22）

`.coderabbit.yaml` に Slack 参照・投稿の指示を書く。例:

```yaml
knowledge_base:
  mcp:
    usage: enabled   # 既定の auto は public リポジトリで MCP を無効化するため明示する
reviews:
  path_instructions:
    - path: "**/*"
      instructions: |
        Use the slackrabbit MCP tools to check the #dev-guidelines Slack
        channel for team coding conventions before reviewing, and apply
        them. After completing the review, post a short Japanese summary
        of the review to the #code-review channel using
        conversations_add_message.
```

- 参照チャンネルには「コードからは分からない規約」を事前投稿しておく（例: 日付は必ず UTC で保持する）とテストの成否を判定しやすい
- 投稿先チャンネルは `SLACK_MCP_ADD_MESSAGE_TOOL` の許可リストに含めること（xoxb 利用時は Bot の join も必要）
- 規約に違反するテスト PR を作り、レビューに Slack 由来の指摘が含まれ、許可チャンネルへ要約が投稿されることを確認する

うまく動かないときは `npx wrangler tail` でツール呼び出しの有無・429 の発生を確認する。

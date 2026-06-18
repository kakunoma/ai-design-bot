# AI×デザイン 注目記事 Bot

Qiita・Zenn・はてなブックマークから「AI×UIUXデザイン」関連の注目記事を毎日収集し、Slackに投稿するBot。

## セットアップ

### 1. リポジトリをGitHubにプッシュ

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_NAME/ai-design-bot.git
git push -u origin main
```

### 2. GitHub Secrets を設定

リポジトリの `Settings > Secrets and variables > Actions` に以下を追加：

| Secret名 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | AnthropicのAPIキー |
| `SLACK_WEBHOOK_URL` | SlackのIncoming Webhook URL |

### 3. Slack Incoming Webhook の発行方法

1. https://api.slack.com/apps にアクセス
2. 「Create New App」→「From scratch」
3. 「Incoming Webhooks」を有効化
4. 投稿先チャンネルを選択してWebhook URLを発行

### 4. 動作確認

GitHub ActionsのページからWorkflowを手動実行（`workflow_dispatch`）で動作確認できます。

## 実行タイミング

毎朝9:00 JST（GitHub ActionsのcronはUTC基準のため `0 0 * * *`）

変更したい場合は `.github/workflows/bot.yml` の `cron` を編集してください。

## 投稿フォーマット

```
06/18のAI×デザイン注目記事

1️⃣ 記事タイトル
要約テキスト（140字以内・日本語）
https://...

2️⃣ ...
```

## 収集ソース・ロジック

- **Qiita**：APIでLGTM数順に取得
- **Zenn**：APIでいいね数順に取得  
- **はてなブックマーク**：ブクマ数で横断的に品質担保
- 3ソース合算後、スコア順で上位5件を選出
- キーワード：`AIデザイン` / `AI UX` / `AI UI` / `生成AI デザイン` / `AIデザイナー`

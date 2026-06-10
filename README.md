# キャリアラダー進捗可視化アプリ

## 概要

このアプリは、従業員のキャリアラダー評価を入力・保存し、レーダーチャート・折れ線グラフで可視化し、AI要約を生成するWebアプリです。

## 構成

- `src/`: React + TypeScript フロントエンド
- `server/`: Express API + 本番時の静的ファイル配信
- `server/migrations/`: PostgreSQL スキーマ（Supabase）
- `requirements.md`: 要件定義

## 技術スタック（本番）

| 役割 | サービス |
|------|----------|
| データベース | [Supabase](https://supabase.com)（PostgreSQL） |
| アプリホスティング | [Railway](https://railway.com)（Hobby プラン） |

## ローカル開発

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数

`.env.example` をコピーして `.env` を作成します。

```bash
cp .env.example .env
```

| 変数 | 説明 |
|------|------|
| `DATABASE_URL` | Supabase の接続文字列（開発は Direct connection ポート 5432 推奨） |
| `JWT_SECRET` | JWT 署名用の秘密鍵 |
| `PORT` | API サーバーポート（既定: 4000） |
| `OPENAI_API_KEY` | AI 要約用（任意） |

### 3. Supabase のセットアップ

1. [Supabase](https://supabase.com) でプロジェクトを作成（リージョン: `ap-northeast-1` 推奨）
2. **Settings → Database → Connection string** から URI をコピー
3. `.env` の `DATABASE_URL` に設定
4. 初回起動時に `server/migrations/001_initial.sql` が自動適用され、テーブルが作成されます

### 4. 開発サーバー起動

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開きます。

## Railway MySQL からのデータ移行

既存の Railway MySQL データを Supabase に移す場合は、TablePlus などでCSVエクスポートし、Supabaseへインポートします（一回限り）。

1. Supabase プロジェクトを作成し、`.env` に `DATABASE_URL` を設定
2. 一度 `npm run dev` または `npm start` でスキーマを作成（または Supabase SQL Editor で `server/migrations/001_initial.sql` を実行）
3. Railway MySQL から以下4テーブルをCSVエクスポート
   - `users`
   - `employees`
   - `evaluations`
   - `evaluation_scores`
4. Supabaseへ同じ順序でCSVインポート
5. Supabase SQL Editor で件数を確認:

```sql
SELECT 'users' AS t, COUNT(*) FROM users
UNION ALL SELECT 'employees', COUNT(*) FROM employees
UNION ALL SELECT 'evaluations', COUNT(*) FROM evaluations
UNION ALL SELECT 'evaluation_scores', COUNT(*) FROM evaluation_scores;
```

**注意:** CSVにはユーザー情報・評価内容が含まれるため、移行後は安全な場所に保管し、不要になった作業ファイルは削除してください。

## Railway へのデプロイ

ビルド・起動コマンドはリポジトリ直下の [`railway.json`](railway.json) から自動で読み込まれます。

1. [Railway](https://railway.com) にログインし、**Hobby プラン**（$5/月）にアップグレード
2. **New Project → Deploy from GitHub repo** で本リポジトリを選択
3. **Variables** タブで環境変数を設定:
   - `DATABASE_URL` … Supabase の **Transaction pooler**（ポート 6543, `?pgbouncer=true`）
   - `JWT_SECRET` … 強力なランダム文字列（移行時は旧環境と同じ値にすると再ログイン不要）
   - `NODE_ENV` … `production`
   - `OPENAI_API_KEY` … 任意
   - `PORT` は Railway が自動注入するため設定不要
4. **Settings → Region** を `Southeast Asia (Singapore)` に設定（Supabase 東京に近い）
5. **Settings → Networking → Generate Domain** で公開 URL を発行
6. 発行された URL でログイン・評価保存を手動テスト

### デプロイ後の確認項目

- [ ] 既存ユーザーでログインできる
- [ ] 評価の一覧・保存・確定/解除
- [ ] 管理者のユーザー・社員 CRUD
- [ ] AI 要約（API キー設定時）

## Render からの切り替え

1. Supabase + Railway で動作確認が取れたら、Render の Web Service を一時停止（Suspend）
2. 社内に新しい URL を周知
3. 数週間問題なければ Render サービスを削除

## API について

`/api/summary` に評価データを送信して要約を生成します。OpenAI API キーが設定されていない場合は、プレースホルダーのメッセージを返します。

## 旧 Render 設定

`render.yaml` は旧 Render デプロイ用の Blueprint です。Railway 移行後は使用しません。
